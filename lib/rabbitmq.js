const amqp = require('amqplib');

const rabbitmqHost = process.env.RABBITMQ_HOST;
const rabbitmqUrl = `amqp://${rabbitmqHost}`;

let connection = null;
let channel = null;

exports.getChannel = function () {
  return channel;
};

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
exports.connectToRabbitMQ = async function (queue) {
  try {
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    console.log("CREATING QUEUE NAMED:", queue);
    await channel.assertQueue(queue);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      await timeout(100);
      await connectToRabbitMQ(queue);
    } else {
      console.error(err);
    }
  }
};