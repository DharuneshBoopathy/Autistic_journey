/// Application-wide constants derived from the PRD specifications.
class AppConstants {
  AppConstants._();

  // -- App Identity --
  static const String appName = 'The Autistic Journey';
  static const String appTagline = 'Private College Batch Gallery Archive';
  static const String appVersion = '1.0.0';

  // -- API Configuration --
  static const String baseApiUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://api.theautisticjourney.me',
  );
  static const String apiV1Prefix = '/api/v1';
  static String get fullApiUrl => '$baseApiUrl$apiV1Prefix';
  static const bool useMockFallback = bool.fromEnvironment(
    'USE_MOCK_FALLBACK',
    defaultValue: false,
  );

  // -- Token Configuration (FR-A03) --
  static const int accessTokenExpiryMinutes = 15;
  static const int refreshTokenExpiryDays = 7;

  // -- Upload Limits (FR-C02, FR-C04) --
  static const int maxBulkUploadFiles = 500;
  static const int maxParallelUploads = 4;
  static const int videoChunkThresholdBytes = 50 * 1024 * 1024; // 50MB
  static const int maxFileSizeBytes = 500 * 1024 * 1024; // 500MB

  // -- Thumbnail Dimensions (FR-D01) --
  static const int thumbSmallSize = 256;
  static const int previewLargeWidth = 1600;
  static const int previewLargeHeight = 1200;

  // -- Signed URL Expiry (FR-D02) --
  static const int signedUrlExpiryMinutes = 15;

  // -- Soft Deletion Retention (FR-E02) --
  static const int deletionRetentionDays = 30;

  // -- Rate Limiting (NFR) --
  static const int maxFailedAuthAttempts = 5;
  static const int authLockoutMinutes = 15;

  // -- Storage Keys --
  static const String accessTokenKey = 'access_token';
  static const String refreshTokenKey = 'refresh_token';
  static const String userIdKey = 'user_id';
  static const String userRoleKey = 'user_role';

  // -- Academic Years (FR-B01) --
  static const List<String> academicYears = [
    'First Year',
    'Second Year',
    'Third Year',
    'Final Year',
  ];

  // -- Event Categories (FR-B01) --
  static const List<String> eventCategories = [
    'Timeline',
    'Campus Life',
    'Trips',
    'Culturals',
    'Hostel',
    'Sports',
    'Highlights',
    'Videos',
    'Other',
  ];

  // -- Visibility Scopes (FR-B03) --
  static const List<String> visibilityScopes = [
    'BATCH_WIDE',
    'GROUP_ONLY',
    'RESTRICTED',
  ];

  // -- User Roles (Section 2.1) --
  static const List<String> userRoles = [
    'SUPER_ADMIN',
    'MODERATOR',
    'MEMBER',
    'READ_ONLY',
  ];

  // -- User Statuses (FR-A02) --
  static const List<String> userStatuses = [
    'PENDING_APPROVAL',
    'ACTIVE',
    'SUSPENDED',
  ];
}
