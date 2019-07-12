const sizeOf = require('image-size');
const jimp = require('jimp');
const fs = require('fs');
const { getDBReference, connectToDB } = require('./lib/mongo');
const { ObjectId, GridFSBucket } = require('mongodb');

const { connectToRabbitMQ, getChannel } = require('./lib/rabbitmq');

const amqp = require('amqplib/callback_api');

const rabbitmqHost = process.env.RABBITMQ_HOST;
const rabbitmqUrl = `amqp://${rabbitmqHost}`;

var amqpConn = null;

async function updatePhotoSizeById(id, size, resizedId) {
  const db = getDBReference();
  const collection = db.collection('photos.files');
  if (!ObjectId.isValid(id)) {
    return null;
  } else {
    if (size === "orig") {
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { "metadata.orig": resizedId }}
      );
      return result.matchedCount > 0;
    } else if (size === "1024") {
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { "metadata.1024": resizedId }}
      );
      return result.matchedCount > 0;
    } else if (size === "640") {
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { "metadata.640": resizedId }}
      );
      return result.matchedCount > 0;
    } else if (size === "256") {
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { "metadata.256": resizedId }}
      );
      return result.matchedCount > 0;
    } else if (size === "128") {
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { "metadata.128": resizedId }}
      );
      return result.matchedCount > 0;
    } else {
      return 0;
    }
  }
};

function getDownloadStreamById(id) {
  const db = getDBReference();
  const bucket = new GridFSBucket(db, { bucketName: 'photos' });
  if (!ObjectId.isValid(id)) {
    return null;
  } else {
    return bucket.openDownloadStream(new ObjectId(id));
  }
};

function savePhotoFile(photo) {
  return new Promise((resolve, reject) => {
    const db = getDBReference();
    const bucket = new GridFSBucket(db, { bucketName: 'photos' });
    const metadata = {
      contentType: photo.contentType,
      businessId: photo.businessid,
      caption: photo.caption
    };
    const uploadStream = bucket.openUploadStream(
      photo.filename,
      { metadata: metadata }
    );
    fs.createReadStream(photo.path)
      .pipe(uploadStream)
      .on('error', (err) => {
        reject(err);
      })
      .on('finish', (result) => {
        resolve(result._id);
      });
  });
}

function removeUploadedFile (path) {
  return new Promise((resolve, reject) => {
    fs.unlink(path, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function closeOnErr(err) {
  if (!err) return false;
  console.error("[AMQP] error", err);
  amqpConn.close();
  return true;
}

function start() {
  amqp.connect(rabbitmqUrl + "?heartbeat=60", function(err, conn) {
    if (err) {
      console.error("[AMQP]", err.message);
      return setTimeout(start, 7000);
    }
    conn.on("error", function(err) {
      if (err.message !== "Connection closing") {
        console.error("[AMQP] conn error", err.message);
      }
    });
    conn.on("close", function() {
      console.error("[AMQP] reconnecting");
      return setTimeout(start, 7000);
    });

    console.log("[AMQP] connected");
    amqpConn = conn;
    connectToDB(main);
  });
}


async function main() {
  try {
    amqpConn.createChannel(function(err, ch) {
      if (closeOnErr(err)) return;
      ch.on("error", function(err) {
        console.error("[AMQP] channel error", err.message);
      });
      ch.on("close", function() {
        console.log("[AMQP] channel closed");
      });
      ch.assertQueue("photos", { durable: true }, async function(err, _ok) {
        if (closeOnErr(err)) return;
        ch.consume('photos', (msg) => {
          if (msg) {
            const id = msg.content.toString();
            const downloadStream = getDownloadStreamById(id);
            const imageData = [];
            downloadStream.on('data', (data) => {
              imageData.push(data);
            });
            downloadStream.on('end', async () => {
              const dimensions = sizeOf(Buffer.concat(imageData));
              jimp.read(Buffer.concat(imageData), (err, lenna) => {
                const sizes = [128, 256, 640, 1024];
                const quality = 60;

                if (err) throw err;

                lenna
                  .resize(dimensions.width, dimensions.height)
                  .quality(60)
                  .greyscale()
                  .write('./uploads/' + id + "_orig.jpg");

                sizes.forEach(function (size) {
                  lenna
                    .resize(size, size)
                    .quality(60)
                    .greyscale()
                    .write('./uploads/' + id + "_" + size + '.jpg');
                });
              });

              if (dimensions.type === 'jpg') {
                const result = await updatePhotoSizeById(id, "orig", id);
                await removeUploadedFile(`./uploads/${id}_orig.jpg`);
              } else {
                try {
                  const photo = {
                    path: `./uploads/${id}_orig.jpg`,
                    filename: `${id}_orig.jpg`,
                    contentType: 'image/jpeg',
                  };
                  const resizedId = await savePhotoFile(photo);
                  await removeUploadedFile(photo.path);
                  const result = await updatePhotoSizeById(id, "orig", resizedId);
                } catch (err) {
                  console.error(err);
                }
              }

              if (dimensions.width > 1024 && dimensions.height > 1024) {
                try {
                  const photo = {
                    path: `./uploads/${id}_1024.jpg`,
                    filename: `${id}_1024.jpg`,
                    contentType: 'image/jpeg',
                  };
                  const resizedId = await savePhotoFile(photo);
                  await removeUploadedFile(`./uploads/${id}_1024.jpg`);
                  const result = await updatePhotoSizeById(id, "1024", resizedId);
                } catch (err) {
                  console.error(err);
                }
              } else {
                await removeUploadedFile(`./uploads/${id}_1024.jpg`);
              }

              if (dimensions.width > 640 && dimensions.height > 640) {
                try {
                  const photo = {
                    path: `./uploads/${id}_640.jpg`,
                    filename: `${id}_640.jpg`,
                    contentType: 'image/jpeg',
                  };
                  const resizedId = await savePhotoFile(photo);
                  await removeUploadedFile(`./uploads/${id}_640.jpg`);
                  const result = await updatePhotoSizeById(id, "640", resizedId);
                } catch (err) {
                  console.error(err);
                }
              } else {
                await removeUploadedFile(`./uploads/${id}_640.jpg`);
              }

              if (dimensions.width > 256 && dimensions.height > 256) {
                try {
                  const photo = {
                    path: `./uploads/${id}_256.jpg`,
                    filename: `${id}_256.jpg`,
                    contentType: 'image/jpeg',
                  };
                  const resizedId = await savePhotoFile(photo);
                  await removeUploadedFile(photo.path);
                  const result = await updatePhotoSizeById(id, "256", resizedId);
                } catch (err) {
                  console.error(err);
                }
              } else {
                await removeUploadedFile(`./uploads/${id}_256.jpg`);
              }

              if (dimensions.width > 128 && dimensions.height > 128) {
                try {
                  const photo = {
                    path: `./uploads/${id}_128.jpg`,
                    filename: `${id}_128.jpg`,
                    contentType: 'image/jpeg',
                  };
                  const resizedId = await savePhotoFile(photo);
                  await removeUploadedFile(photo.path);
                  const result = await updatePhotoSizeById(id, "128", resizedId);
                } catch (err) {
                  console.error(err);
                }
              } else {
                await removeUploadedFile(`./uploads/${id}_128.jpg`);
              }
            });
          }
          ch.ack(msg);
        }, { noAck: false });
      });
    });
  } catch (err) {
    console.error(err);
  }
}
start();
