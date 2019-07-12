/*
 * API sub-router for businesses collection endpoints.
 */
const express = require('express');
const fs      = require('fs');
const router  = require('express').Router();
const crypto  = require('crypto');
const multer  = require('multer');
const sizeOf = require('image-size');
const amqp = require('amqplib');

const { connectToRabbitMQ, getChannel } = require('../lib/rabbitmq');

const { ObjectId, GridFSBucket } = require('mongodb');

const { getDBReference, connectToDB } = require('../lib/mongo');

const imageTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

const upload = multer({
  storage: multer.diskStorage({
    destination: `${__dirname}/uploads`,
    filename: (req, file, callback) => {
      const filename = crypto.pseudoRandomBytes(16).toString('hex');
      const extension = imageTypes[file.mimetype];
      callback(null, `${filename}.${extension}`);
    }
  }),
  fileFilter: (req, file, callback) => {
    callback(null, !!imageTypes[file.mimetype]);
  }
});

/*
 * Route to create a new photo.
 */
router.post('/', upload.single('photo'), async (req, res, next) => {
  console.log("== req.file:", req.file.filename);
  console.log("== req.body:", req.body);
  if (req.file && req.body && req.body.businessid) {
    try {
      const photo = {
        path: req.file.path,
        filename: req.file.filename,
        contentType: req.file.mimetype,
        businessid: req.body.businessid,
        caption: req.body.caption
      };
      await connectToRabbitMQ('photos');
      const id = await savePhotoFile(photo);
      await removeUploadedFile(req.file);

      const channel = getChannel();
      channel.sendToQueue('photos', Buffer.from(id.toString()));
      res.status(200).send({ id: id });
    } catch (err) {
      next(err);
    }
  } else {
    res.status(400).send({
      err: "Request body was invalid."
    });
  }
});

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

function removeUploadedFile(file) {
  return new Promise((resolve, reject) => {
    fs.unlink(file.path, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
/*
 * Route to fetch info about a specific photo.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const photo = await getPhotoInfoById(req.params.id);
    if (photo) {
      const responseBody = {
        _id: photo._id,
        orig: `/photos/media/photos/${photo._id}-orig.jpg`,
        "128": `/photos/media/photos/${photo._id}-128.jpg`,
        "256": `/photos/media/photos/${photo._id}-256.jpg`,
        "640": `/photos/media/photos/${photo._id}-640.jpg`,
        "1024": `/photos/media/photos/${photo._id}-1024.jpg`,
        contentType: photo.metadata.contentType,
        businessid: photo.metadata.businessid
      };
      console.log(photo.metadata.size);
      res.status(200).send(responseBody);
    } else {
      next();
    }
  } catch (err) {
    console.error(err);
    next(err);
    res.status(500).send({
      error: "Unable to fetch photo.  Please try again later."
    });
  }
});

router.get('/media/photos/:filename', async (req, res, next) => {
  const filename = req.params.filename.split("-")[0];
  const filesize = req.params.filename.split("-")[1].split(".")[0];

  const photo = await getPhotoInfoById(filename);

  if (photo) {
    const photoId = photo.metadata[filesize];
    if (photoId) {
      getDownloadStreamById(photoId)
        .on('error', (err) => {
          if (err.code === 'ENOENT') {
            next();
          } else {
            next(err);
          }
        })
        .on('file', (file) => {
          res.status(200).type(file.metadata.contentType);
        })
        .pipe(res);
    } else {
      res.status(404).send({
        err: "Image size not available to download"
      });
    }
  } else {
    next();
  }
});

function getDownloadStreamById(id) {
  const db = getDBReference();
  const bucket = new GridFSBucket(db, { bucketName: 'photos' });
  if (!ObjectId.isValid(id)) {
    return null;
  } else {
    return bucket.openDownloadStream(new ObjectId(id));
  }
};

async function getPhotoInfoById(id) {
  const db = getDBReference();
  const bucket =
  new GridFSBucket(db, { bucketName: 'photos' });

  if (!ObjectId.isValid(id)) {
    return null;
  } else {
    const results = await bucket.find({ _id: new ObjectId(id) }).toArray();
    return results[0];
  }
}

function getPhotoDownloadStreamByFilename(filename) {
  const db = getDBReference();
  const bucket = new GridFSBucket(db, { bucketName: 'photos' });
  return bucket.openDownloadStreamByName(filename);
}

router.use('*', (err, req, res, next) => {
  console.error(err);
  res.status(500).send({
	err: "An error occurred.  Try again later."
  });
});

module.exports = router;
