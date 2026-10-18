import 'package:flutter/material.dart';

/// Nite Riot-inspired design system with mercury/liquid aesthetic.
/// Dark-first design with off-white accents and editorial typography.
class AppColors {
  AppColors._();

  // -- Core Palette (Nite Riot inspired) --
  static const Color background = Color(0xFF050505);
  static const Color surface = Color(0xFF0A0A0A);
  static const Color surfaceElevated = Color(0xFF111111);
  static const Color surfaceOverlay = Color(0xFF1A1A1A);
  static const Color surfaceCard = Color(0xFF141414);

  // -- Mercury / Silver Accents --
  static const Color mercury = Color(0xFFE0E0E0);
  static const Color mercuryDark = Color(0xFF666666);
  static const Color mercuryGlow = Color(0xFF999999);
  static const Color mercurySubtle = Color(0xFF333333);

  // -- Primary Text --
  static const Color textPrimary = Color(0xFFFFFFFF);
  static const Color textSecondary = Color(0xFFAAAAAA);
  static const Color textDim = Color(0x80FFFFFF); // 50% opacity white
  static const Color textMuted = Color(0x33FFFFFF); // 20% opacity white

  // -- Accent Colors --
  static const Color accent = Color(0xFFFFFFFF);
  static const Color accentWarm = Color(0xFFE8C084); // warm copper
  static const Color accentBlue = Color(0xFF4A90D9);
  static const Color accentSuccess = Color(0xFF4CAF50);
  static const Color accentWarning = Color(0xFFFFC107);
  static const Color accentDanger = Color(0xFFEF5350);

  // -- Status Colors --
  static const Color statusPending = Color(0xFFFFC107);
  static const Color statusApproved = Color(0xFF4CAF50);
  static const Color statusRejected = Color(0xFFEF5350);
  static const Color statusSuspended = Color(0xFFFF7043);

  // -- Interactive --
  static const Color divider = Color(0x1AFFFFFF); // 10% white
  static const Color border = Color(0x1AFFFFFF);
  static const Color borderFocused = Color(0xFFE0E0E0);
  static const Color shimmerBase = Color(0xFF1A1A1A);
  static const Color shimmerHighlight = Color(0xFF2A2A2A);

  // -- Gradients --
  static const LinearGradient mercuryGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFE0E0E0), Color(0xFF888888)],
  );

  static const LinearGradient darkFade = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0x00000000), Color(0xFF050505)],
  );

  static const LinearGradient heroOverlay = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [Color(0xCC050505), Color(0x00050505), Color(0xCC050505)],
  );

  // -- Year-specific accent colors for Academic Year tabs --
  static const List<Color> yearAccents = [
    Color(0xFF4A90D9), // First Year - Blue
    Color(0xFF66BB6A), // Second Year - Green
    Color(0xFFE8C084), // Third Year - Copper
    Color(0xFFEF5350), // Final Year - Red
  ];
}

/// Typography system inspired by Nite Riot's editorial condensed look.
class AppTextStyles {
  AppTextStyles._();

  // -- Display (Large hero titles like NITE RIOT logo) --
  static const TextStyle displayLarge = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 64,
    fontWeight: FontWeight.w800,
    letterSpacing: -3,
    height: 0.9,
    color: AppColors.textPrimary,
  );

  static const TextStyle displayMedium = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 48,
    fontWeight: FontWeight.w800,
    letterSpacing: -2,
    height: 0.9,
    color: AppColors.textPrimary,
  );

  // -- Headings --
  static const TextStyle headlineLarge = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 32,
    fontWeight: FontWeight.w800,
    letterSpacing: -1,
    height: 1.1,
    color: AppColors.textPrimary,
  );

  static const TextStyle headlineMedium = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 24,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.5,
    height: 1.2,
    color: AppColors.textPrimary,
  );

  static const TextStyle headlineSmall = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 20,
    fontWeight: FontWeight.w700,
    letterSpacing: 0,
    height: 1.2,
    color: AppColors.textPrimary,
  );

  // -- Label (Uppercase mono labels like "WORK (24)", "INSPIRED (41)") --
  static const TextStyle labelLarge = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 12,
    fontWeight: FontWeight.w400,
    letterSpacing: 4,
    height: 1.4,
    color: AppColors.textDim,
  );

  static const TextStyle labelMedium = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 10,
    fontWeight: FontWeight.w400,
    letterSpacing: 3,
    height: 1.4,
    color: AppColors.textDim,
  );

  static const TextStyle labelSmall = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 9,
    fontWeight: FontWeight.w400,
    letterSpacing: 2,
    height: 1.4,
    color: AppColors.textMuted,
  );

  // -- Body --
  static const TextStyle bodyLarge = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.6,
    color: AppColors.textSecondary,
  );

  static const TextStyle bodyMedium = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: AppColors.textSecondary,
  );

  static const TextStyle bodySmall = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: AppColors.textDim,
  );

  // -- Button --
  static const TextStyle buttonLarge = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 14,
    fontWeight: FontWeight.w800,
    letterSpacing: 2,
    color: Color(0xFF000000),
  );

  static const TextStyle buttonMedium = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 12,
    fontWeight: FontWeight.w700,
    letterSpacing: 1.5,
    color: AppColors.textPrimary,
  );

  // -- Nav items (like WORK, INSPIRED, INDEX, ABOUT, CONTACT) --
  static const TextStyle navItem = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 11,
    fontWeight: FontWeight.w700,
    letterSpacing: 2,
    color: AppColors.textPrimary,
  );

  // -- Marquee / Scrolling brand text --
  static const TextStyle marquee = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 28,
    fontWeight: FontWeight.w800,
    letterSpacing: 4,
    color: AppColors.mercuryDark,
  );

  // -- Superscript count (like the (24) in "WORK(24)") --
  static const TextStyle superscript = TextStyle(
    fontFamily: 'SpaceMono',
    fontSize: 8,
    fontWeight: FontWeight.w400,
    color: AppColors.textDim,
  );
}

/// Spacing scale used throughout the app.
class AppSpacing {
  AppSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
  static const double xxxl = 64;
  static const double heroSpacing = 80;
}

/// Radius values.
class AppRadius {
  AppRadius._();

  static const double none = 0;
  static const double sm = 4;
  static const double md = 8;
  static const double lg = 16;
  static const double xl = 24;
  static const double full = 999;
}

/// Durations for animations.
class AppDurations {
  AppDurations._();

  static const Duration instant = Duration(milliseconds: 100);
  static const Duration fast = Duration(milliseconds: 200);
  static const Duration normal = Duration(milliseconds: 300);
  static const Duration slow = Duration(milliseconds: 500);
  static const Duration verySlow = Duration(milliseconds: 800);
  static const Duration pageTransition = Duration(milliseconds: 400);
  static const Duration splash = Duration(seconds: 2);
}

/// Curves for animations.
class AppCurves {
  AppCurves._();

  static const Curve defaultCurve = Curves.easeOutCubic;
  static const Curve smooth = Cubic(0.2, 1, 0.3, 1);
  static const Curve bouncy = Cubic(0.175, 0.885, 0.32, 1.275);
  static const Curve decelerate = Curves.decelerate;
}
