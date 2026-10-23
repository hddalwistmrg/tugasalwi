# 🚀 TaskFlow - Catatan Tugas Pribadi

Website manajemen catatan tugas pribadi yang dibangun menggunakan **Vue 3**, didesain modern, cepat, dan siap online 100% gratis dengan **Firebase Cloud Firestore** dan **Vercel**.

---

## ✨ Fitur-Fitur Utama

1. **Desain Modern & Responsif**:
   - Tampilan bersih (*clean dashboard*) dengan dukungan **Mode Gelap (Dark Mode)** dan **Mode Terang (Light Mode)**.
   - Responsif untuk layar smartphone, tablet, maupun laptop.

2. **Sistem Deadline & Countdown Cerdas**:
   - Deteksi batas waktu otomatis dengan badge warna:
     - 🚨 **Merah**: Melewati batas waktu (Terlambat)
     - ⚡ **Kuning/Oranye**: Mendesak (Hari ini atau besok)
     - 🟢 **Abu-abu/Hijau**: Waktu pengerjaan masih aman

3. **Kategori & Prioritas Tugas**:
   - Pemisahan mata kuliah (Pemrograman Web, Basis Data, Jaringan, Kalkulus, dll.) atau kategori kustom.
   - 3 Tingkat Prioritas: 🔥 **Tinggi**, ⚡ **Sedang**, ☕ **Rendah**.

4. **Statistik & Pencarian**:
   - Kartu statistik: Total Tugas, Sedang Dikerjakan, Selesai (dengan persentase *progress bar*), dan Mendekati Deadline.
   - Pencarian instan berdasarkan judul, deskripsi tugas, atau nama mata kuliah.
   - Filter berdasarkan status (Semua, Aktif, Selesai) dan pengurutan (Deadline terdekat, prioritas tertinggi, terbaru).

5. **Multi-Storage (Lokal & Cloud)**:
   - **Mode Offline (Default)**: Langsung berjalan menggunakan `localStorage` tanpa perlu konfigurasi apa pun.
   - **Mode Online (Cloud Sync)**: Terhubung ke **Firebase Cloud Firestore** secara *realtime*.
   - **Autentikasi Google**: Login akun Google dengan 1 klik untuk mengakses catatan tugas dari perangkat mana pun.

---

## 💻 Cara Menjalankan Secara Lokal

Buka terminal di folder `taskflow`:

```bash
# 1. Masuk ke folder proyek
cd taskflow

# 2. Install dependensi (termasuk Firebase)
npm install

# 3. Jalankan server lokal
npm run dev
```

Buka URL lokal yang muncul di browser Anda (biasanya `http://localhost:5173`).

---

## ☁️ Menghubungkan Firebase (100% Gratis Selamanya)

1. Buka [Firebase Console](https://console.firebase.google.com/) dan login dengan akun Google Anda.
2. Klik **Add Project** dan beri nama proyek Anda (misal: `taskflow-alwi`).
3. Di panel samping:
   - Pilih **Build > Firestore Database** -> Klik **Create Database** -> Pilih lokasi dan mode test/production.
   - Pilih **Build > Authentication** -> Klik **Get Started** -> Pilih tab **Sign-in method** -> Aktifkan **Google**.
4. Buka **Project Settings** (ikon gerigi) -> Scroll ke bawah ke bagian **Your apps** -> Klik ikon **Web `</>`** -> Daftarkan aplikasi.
5. Salin objek `firebaseConfig` yang muncul.
6. Buka website TaskFlow Anda, klik tombol **Local Storage / Cloud Sync** di navbar kanan atas, lalu tempel (*paste*) konfigurasinya dan klik **Simpan & Hubungkan**.
7. Klik **Upload ke Cloud ☁️** untuk memindahkan catatan lama di komputer Anda ke Firebase!

---

## 🌐 Cara Deploy ke Vercel (100% Gratis & Selamanya Online)

1. Upload folder proyek ini ke repositori **GitHub** pribadi Anda.
2. Buka [Vercel.com](https://vercel.com/) dan daftar/masuk dengan akun GitHub.
3. Klik **Add New... > Project** dan pilih repositori Anda.
4. Pada bagian **Root Directory**, pilih folder `taskflow`.
5. Klik **Deploy**!
6. Dalam hitungan detik, website Anda sudah aktif online di URL `https://nama-proyek-anda.vercel.app`.
