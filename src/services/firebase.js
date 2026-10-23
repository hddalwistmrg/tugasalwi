// Firebase service module with resilient fallback to localStorage
// Supports environment variables (VITE_FIREBASE_*) and in-app config storage

let app = null;
let db = null;
let auth = null;
let googleProvider = null;
let firestoreModules = null;
let authModules = null;

const STORAGE_KEY = "taskflow_firebase_config";

export function getSavedConfig() {
  const envConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
  };

  if (envConfig.apiKey && envConfig.projectId) {
    return { ...envConfig, source: "env" };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.apiKey && parsed.projectId) {
        return { ...parsed, source: "local" };
      }
    }
  } catch (e) {
    console.warn("Gagal membaca saved Firebase config:", e);
  }

  return null;
}

export function saveConfig(config) {
  if (!config) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export async function initFirebase(customConfig = null) {
  const config = customConfig || getSavedConfig();
  if (!config || !config.apiKey || !config.projectId) {
    return { initialized: false, reason: "Konfigurasi Firebase belum diisi." };
  }

  try {
    // Gunakan official Firebase ESM CDN dengan @vite-ignore agar tidak error meskipun belum 'npm install firebase'
    const CDN_BASE = "https://www.gstatic.com/firebasejs/10.12.0";
    
    const { initializeApp, getApps, getApp } = await import(
      /* @vite-ignore */ `${CDN_BASE}/firebase-app.js`
    );
    firestoreModules = await import(
      /* @vite-ignore */ `${CDN_BASE}/firebase-firestore.js`
    );
    authModules = await import(
      /* @vite-ignore */ `${CDN_BASE}/firebase-auth.js`
    );

    app = getApps().length ? getApp() : initializeApp(config);
    db = firestoreModules.getFirestore(app);
    auth = authModules.getAuth(app);
    googleProvider = new authModules.GoogleAuthProvider();

    return { initialized: true, app, db, auth };
  } catch (error) {
    console.error("Firebase init error:", error);
    return { initialized: false, error: error.message };
  }
}

export function isFirebaseReady() {
  return !!(db && firestoreModules);
}

// Auth helpers
export async function loginWithGoogle() {
  if (!auth || !authModules) {
    throw new Error("Firebase Auth belum aktif. Silakan hubungkan Firebase terlebih dahulu.");
  }
  const result = await authModules.signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logoutUser() {
  if (!auth || !authModules) return;
  await authModules.signOut(auth);
}

export function onAuthChange(callback) {
  if (!auth || !authModules) {
    callback(null);
    return () => {};
  }
  return authModules.onAuthStateChanged(auth, callback);
}

// Firestore Realtime Task helpers
export function subscribeToTasks(userId, onUpdate, onError) {
  if (!db || !firestoreModules) {
    return () => {};
  }

  const { collection, query, where, onSnapshot } = firestoreModules;
  const colRef = collection(db, "tasks");

  let q;
  if (userId) {
    q = query(colRef, where("userId", "==", userId));
  } else {
    q = query(colRef);
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      // Sort in memory by createdAt descending
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onUpdate(items);
    },
    (err) => {
      console.error("Firestore snapshot error:", err);
      if (onError) onError(err);
    }
  );
}

export async function syncTaskToCloud(task, userId = null) {
  if (!db || !firestoreModules) return null;
  const { doc, setDoc } = firestoreModules;
  const taskId = task.id || crypto.randomUUID();
  const payload = {
    ...task,
    id: taskId,
    userId: userId || null,
    updatedAt: Date.now(),
    createdAt: task.createdAt || Date.now()
  };

  await setDoc(doc(db, "tasks", taskId), payload, { merge: true });
  return payload;
}

export async function deleteTaskFromCloud(taskId) {
  if (!db || !firestoreModules) return;
  const { doc, deleteDoc } = firestoreModules;
  await deleteDoc(doc(db, "tasks", taskId));
}
