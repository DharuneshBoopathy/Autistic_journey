# The Autistic Journey (TAJ)

> **Private College Batch Gallery Archive (Batch of 2023–2027)**  
> Built with **Flutter**, **Riverpod**, **GoRouter**, and an editorial dark aesthetic inspired by **[Nite Riot](https://www.nite-riot.com/)** and **Mercury liquid interactive UI**.

---

## ✦ Aesthetic & Design System

The application blends **Nite Riot’s** brutalist luxury dark editorial layout with **Mercury liquid fluid dynamics**:

- **Dark-First Palette**: Deep pitch background (`#050505`), elevated card surfaces (`#0A0A0A`, `#141414`), subtle ultra-fine borders (`0.5px` silver dividers).
- **SpaceMono Brutalist Typography**: Monospaced uppercase identifiers (`SYSTEM NODE: TAJ-001`, `BATCH 2023-2027 ARCHIVE`, `[SYMPOSIUM]`).
- **Mercury Liquid Motion**: Fluid animated organic blobs on login, morphing button states, and glowing input focus underlines.
- **Dynamic Frame Hover**: Interactive album cards that elevate and zoom cover media with smooth cubic easing.
- **Editorial Top Navigation Shell**: Real-time batch clock ticker, academic year badges, and route indicators.

---

## ✦ Core Features & PRD Alignment

| Feature | Screen / Component | PRD Spec | Description |
|---|---|---|---|
| **Mercury Liquid Login** | `login_screen.dart` | FR-A03 | Fluid blob animation, glowing underlines, morphing submit button |
| **Batch Registration** | `register_screen.dart` | FR-A01 | Roll number, college email, batch year, gender validation |
| **Awaiting Approval** | `pending_approval_screen.dart` | FR-A02 | Post-registration review state with animated hourglass indicator |
| **Editorial Gallery Home** | `gallery_home_screen.dart` | FR-B01, FR-B02 | Academic year tabs (1st–Final Year), category filters, live search, stats |
| **Staggered Album Vault** | `album_detail_screen.dart` | FR-V01, FR-V02, FR-V03 | Masonry grid, multi-select batch ZIP download, hover metadata |
| **Lossless Lightbox** | `lightbox_screen.dart` | FR-V04 | Fullscreen pinch/interactive zoom, EXIF metadata drawer, lossless download |
| **Direct S3 Upload Drop** | `upload_screen.dart` | FR-U01, FR-U02, FR-U03 | Drag-and-drop zone, album selector, SHA-256 deduplication, chunked upload queue |
| **Admin Command Console** | `admin_dashboard_screen.dart` | FR-M01–M04 | One-click student approvals/rejections, directory, audit ledger, S3 telemetry |
| **Identity Profile** | `profile_screen.dart` | Sec 2.1 | Student credentials, contribution statistics, encrypted session management |

---

## ✦ Project Structure

```
the_autistic_journey/
├── assets/
│   ├── fonts/
│   │   ├── SpaceMono-Regular.ttf
│   │   └── SpaceMono-Bold.ttf
│   ├── images/
│   └── icons/
├── lib/
│   ├── main.dart                          # Application entry point with ProviderScope
│   ├── core/
│   │   ├── constants/app_constants.dart   # PRD limits, academic years, categories
│   │   ├── router/app_router.dart         # GoRouter setup with auth state redirects
│   │   ├── theme/
│   │   │   ├── app_theme.dart             # Material 3 ThemeData definition
│   │   │   └── app_theme_tokens.dart      # Design tokens (colors, SpaceMono text, animations)
│   │   └── widgets/
│   │       └── app_shell.dart             # Nite Riot desktop top-bar & mobile bottom nav
│   ├── features/
│   │   ├── auth/
│   │   │   ├── presentation/screens/
│   │   │   │   ├── login_screen.dart
│   │   │   │   ├── register_screen.dart
│   │   │   │   └── pending_approval_screen.dart
│   │   │   └── providers/auth_provider.dart
│   │   ├── gallery/
│   │   │   ├── presentation/screens/gallery_home_screen.dart
│   │   │   └── providers/gallery_provider.dart
│   │   ├── album/
│   │   │   └── presentation/screens/album_detail_screen.dart
│   │   ├── lightbox/
│   │   │   └── presentation/lightbox_screen.dart
│   │   ├── upload/
│   │   │   └── presentation/screens/upload_screen.dart
│   │   ├── admin/
│   │   │   └── presentation/screens/admin_dashboard_screen.dart
│   │   └── profile/
│   │       └── presentation/screens/profile_screen.dart
│   └── models/
│       ├── album_model.dart               # Album & MediaItem models with mock factories
│       └── user_model.dart                # Student UserModel & verification roles
└── pubspec.yaml
```

---

## ✦ Running Locally

```bash
# 1. Navigate to the project directory
cd the_autistic_journey

# 2. Install dependencies
flutter pub get

# 3. Launch the app in your browser or emulator
flutter run -d chrome
```

---

## ✦ Authentication & Account Provisioning

- **Batch Registration (FR-A01)**: Students register with their college roll number and email.
- **Administrator Approval Gate (FR-A02)**: Accounts enter `PENDING_APPROVAL` status until approved via the Admin Command Console.
- **Initial Setup**: Configure backend secrets in `.env` and initialize the administrator through the secure backend onboarding process.
