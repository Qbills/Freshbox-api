const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

async function sendPushNotification(fcmToken, title, body) {
  try {
    const message = {
      notification: {
        title: title,
        body: body
      },
      token: fcmToken
    };

    const response = await admin.messaging().send(message);
    console.log('Notification sent successfully:', response);
    return { success: true, response };
  } catch (error) {
    console.log('Error sending notification:', error);
    return { success: false, error };
  }
}

async function sendOrderAssignedNotification(fcmToken, orderDetails) {
  const title = 'New order assigned 🛵';
  const body = `You have a new delivery to ${orderDetails.address}. Tap to view details.`;
  return sendPushNotification(fcmToken, title, body);
}

async function sendOrderUpdateNotification(fcmToken, status) {
  const title = 'Order update';
  const body = `Your order status has been updated to: ${status}`;
  return sendPushNotification(fcmToken, title, body);
}

module.exports = {
  sendPushNotification,
  sendOrderAssignedNotification,
  sendOrderUpdateNotification
};