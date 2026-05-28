// FreshBox Driver App — API Service
// Replace mockData.js calls with these functions
// Place this file at: src/services/api.js

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Change this to your Railway URL after deploying ───────────────────────
const BASE_URL = __DEV__
  ? 'http://10.0.2.2:3000/api'   // Android emulator → localhost
  : 'https://your-app.railway.app/api'; // Production

// ── Token management ──────────────────────────────────────────────────────
async function getAccessToken() {
  return await AsyncStorage.getItem('accessToken');
}

async function saveTokens(accessToken, refreshToken) {
  await AsyncStorage.setItem('accessToken', accessToken);
  await AsyncStorage.setItem('refreshToken', refreshToken);
}

async function clearTokens() {
  await AsyncStorage.multiRemove(['accessToken', 'refreshToken']);
}

// ── Base fetch with auto token refresh ────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = await getAccessToken();

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  };

  let response = await fetch(`${BASE_URL}${path}`, config);

  // Auto-refresh on 401
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const newToken = await getAccessToken();
      config.headers.Authorization = `Bearer ${newToken}`;
      response = await fetch(`${BASE_URL}${path}`, config);
    } else {
      throw new Error('SESSION_EXPIRED');
    }
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function refreshAccessToken() {
  try {
    const refreshToken = await AsyncStorage.getItem('refreshToken');
    if (!refreshToken) return false;

    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      await clearTokens();
      return false;
    }

    const data = await response.json();
    await saveTokens(data.data.accessToken, data.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────
export const AuthAPI = {
  async login(email, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await saveTokens(data.data.accessToken, data.data.refreshToken);
    return data.data.driver;
  },

  async logout() {
    const refreshToken = await AsyncStorage.getItem('refreshToken');
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch {}
    await clearTokens();
  },

  async getProfile() {
    const data = await apiFetch('/auth/me');
    return data.data;
  },

  async updateFcmToken(fcmToken) {
    return await apiFetch('/auth/fcm-token', {
      method: 'PATCH',
      body: JSON.stringify({ fcmToken }),
    });
  },

  async isLoggedIn() {
    const token = await getAccessToken();
    return !!token;
  },
};

// ── Route & Stops ─────────────────────────────────────────────────────────
export const RouteAPI = {
  async getTodayRoute() {
    const data = await apiFetch('/route/today');
    return data.data;
  },

  async getStop(stopId) {
    const data = await apiFetch(`/route/stops/${stopId}`);
    return data.data;
  },

  async markDelivered(stopId, photoUrl = null) {
    const data = await apiFetch(`/route/stops/${stopId}/deliver`, {
      method: 'PATCH',
      body: JSON.stringify({ photoUrl }),
    });
    return data.data;
  },

  async updateLocation(latitude, longitude, speed = null, heading = null) {
    return await apiFetch('/route/location', {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude, speed, heading }),
    });
  },
};

// ── Messages ──────────────────────────────────────────────────────────────
export const MessagesAPI = {
  async getConversations() {
    const data = await apiFetch('/messages');
    return data.data;
  },

  async getThread(stopId) {
    const data = await apiFetch(`/messages/${stopId}`);
    return data.data;
  },

  async sendMessage(stopId, text) {
    const data = await apiFetch(`/messages/${stopId}`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return data.data;
  },
};

// ── Earnings ──────────────────────────────────────────────────────────────
export const EarningsAPI = {
  async getEarnings(period = 'today') {
    const data = await apiFetch(`/earnings?period=${period}`);
    return data.data;
  },
};

// ── WebSocket / Socket.io ─────────────────────────────────────────────────
// npm install socket.io-client
// import { io } from 'socket.io-client';
// 
// export function createSocket(accessToken) {
//   const socket = io(BASE_URL.replace('/api', ''), {
//     auth: { token: accessToken },
//     transports: ['websocket'],
//   });
//
//   socket.on('connect', () => console.log('Socket connected'));
//   socket.on('disconnect', () => console.log('Socket disconnected'));
//
//   return socket;
// }

export default { AuthAPI, RouteAPI, MessagesAPI, EarningsAPI };
