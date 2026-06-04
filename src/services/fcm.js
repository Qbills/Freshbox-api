// FreshBoxAPI/src/services/fcm.js
// Firebase Cloud Messaging — sends push notifications to customers

const https = require('https');
const { GoogleAuth } = require('google-auth-library');

const STATUS_MESSAGES = {
  confirmed: {
    title: '✅ Order confirmed',
    body: 'Your Pantri order has been confirmed and is being prepared.',
  },
  preparing: {
    title: '📦 Packing your order',
    body: 'Your meal kit is being carefully packed and will be on its way soon.',
  },
  out_for_delivery: {
    title: '🛵 Your order is on the way',
    body: 'Your driver is heading to you now. Track your order in the app.',
  },
  delivered: {
    title: '🎉 Order delivered!',
    body: 'Your Pantri order has been delivered. Enjoy your meal!',
  },
  cancelled: {
    title: '❌ Order cancelled',
    body: 'Your order has been cancelled. Contact support if you need help.',
  },
};

async function getFirebaseAccessToken() {
  // Fix private key — Railway stores \n as literal characters, convert to real newlines
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  if (!privateKey) {
    throw new Error('FIREBASE_PRIVATE_KEY not configured');
  }

  const credentials = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: privateKey,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

async function sendOrderStatusNotification(fcmToken, status, orderId) {
  const message = STATUS_MESSAGES[status];
  if (!message || !fcmToken) return;

  const orderRef = `#PNT-${String(orderId).padStart(4, '0')}`;

  const payload = {
    message: {
      token: fcmToken,
      notification: {
        title: message.title,
        body: message.body,
      },
      data: {
        orderId: String(orderId),
        orderRef,
        status,
        type: 'order_status_update',
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channel_id: 'pantri_orders',
        },
      },
    },
  };

  try {
    const accessToken = await getFirebaseAccessToken();
    const projectId = process.env.FIREBASE_PROJECT_ID;

    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const options = {
        hostname: 'fcm.googleapis.com',
        path: `/v1/projects/${projectId}/messages:send`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`✅ Push notification sent for order ${orderRef} — status: ${status}`);
            resolve(JSON.parse(data));
          } else {
            console.error(`FCM error ${res.statusCode}:`, data);
            reject(new Error(`FCM error: ${res.statusCode} — ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error('Failed to send push notification:', err.message);
  }
}

module.exports = { sendOrderStatusNotification };