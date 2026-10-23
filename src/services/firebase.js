// Firebase service module for TaskFlow
// Directly configured for taskflow-alwi

export const firebaseConfig = {
  apiKey: "AIzaSyCYzBVQQW0oFTRklLdiWWdn50v-zh70u8k",
  authDomain: "taskflow-alwi.firebaseapp.com",
  projectId: "taskflow-alwi",
  storageBucket: "taskflow-alwi.firebasestorage.app",
  messagingSenderId: "443041146143",
  appId: "1:443041146143:web:f0023caa22f3b9841e3c2a",
  measurementId: "G-Z3KQ06JC7L"
};

let app = null;
let db = null;
let auth = null;
let googleProvider = null;
let firestoreModules = null;
let authModules = null;

export async function initFirebase() {
  try {
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

    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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

// Google Authentication
export async function loginWithGoogle() {
  if (!auth || !authModules) {
    await initFirebase();
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

// Firestore Realtime Tasks scoped to logged in user
export function subscribeToTasks(userId, onUpdate, onError) {
  if (!db || !firestoreModules || !userId) {
    return () => {};
  }

  const { collection, query, where, onSnapshot } = firestoreModules;
  const colRef = collection(db, "tasks");
  const q = query(colRef, where("userId", "==", userId));

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

export async function syncTaskToCloud(task, userId) {
  if (!db || !firestoreModules || !userId) return null;
  const { doc, setDoc } = firestoreModules;
  const taskId = task.id || crypto.randomUUID();
  const payload = {
    ...task,
    id: taskId,
    userId: userId,
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
