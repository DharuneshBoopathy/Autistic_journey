import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../constants/app_constants.dart';
import '../../models/user_model.dart';
import '../../models/album_model.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;

  late final Dio _dio;
  late final Dio _tokenDio;
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();
  String? _cachedAccessToken;
  User? _currentUser;
  bool _isRefreshing = false;
  void Function()? onSessionExpired;

  User? get currentUser => _currentUser;
  String? get accessToken => _cachedAccessToken;

  ApiService._internal() {
    _dio = Dio(
      BaseOptions(
        baseUrl: AppConstants.fullApiUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    _tokenDio = Dio(
      BaseOptions(
        baseUrl: AppConstants.fullApiUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 10),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = _cachedAccessToken ?? await _getStoredToken(AppConstants.accessTokenKey);
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onError: (DioException error, handler) async {
          final is401 = error.response?.statusCode == 401;
          final path = error.requestOptions.path;
          final isAuthEndpoint = path.contains('/auth/login') || path.contains('/auth/refresh');

          if (is401 && !isAuthEndpoint && !_isRefreshing) {
            _isRefreshing = true;
            try {
              final newAccessToken = await refreshToken();
              _isRefreshing = false;

              if (newAccessToken != null && newAccessToken.isNotEmpty) {
                // Retry failed request with new access token
                final reqOptions = error.requestOptions;
                reqOptions.headers['Authorization'] = 'Bearer $newAccessToken';
                final response = await _dio.fetch(reqOptions);
                return handler.resolve(response);
              }
            } catch (_) {
              _isRefreshing = false;
            }

            // Refresh failed or returned null: purge session and notify listeners
            await _clearStoredTokens();
            _cachedAccessToken = null;
            _currentUser = null;
            onSessionExpired?.call();
          }

          return handler.next(error);
        },
      ),
    );
  }

  Future<void> _storeToken(String key, String value) async {
    try {
      await _secureStorage.write(key: key, value: value);
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(key, value);
    } catch (_) {}
  }

  Future<String?> _getStoredToken(String key) async {
    try {
      final val = await _secureStorage.read(key: key);
      if (val != null && val.isNotEmpty) return val;
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(key);
    } catch (_) {
      return null;
    }
  }

  Future<void> _clearStoredTokens() async {
    try {
      await _secureStorage.deleteAll();
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(AppConstants.accessTokenKey);
      await prefs.remove(AppConstants.refreshTokenKey);
      await prefs.remove(AppConstants.userIdKey);
      await prefs.remove(AppConstants.userRoleKey);
    } catch (_) {}
  }

  // --- Authentication ---

  Future<User> login(String email, String password) async {
    final response = await _dio.post(
      '/auth/login',
      data: {
        'email': email.trim().toLowerCase(),
        'password': password,
      },
    );

    final data = response.data;
    final token = data['access_token'] as String;
    final refreshTokenVal = data['refresh_token'] as String?;
    final userData = data['user'] as Map<String, dynamic>;

    _cachedAccessToken = token;
    await _storeToken(AppConstants.accessTokenKey, token);
    if (refreshTokenVal != null) {
      await _storeToken(AppConstants.refreshTokenKey, refreshTokenVal);
    }

    _currentUser = User.fromJson(userData);
    return _currentUser!;
  }

  Future<String?> refreshToken() async {
    final storedRefreshToken = await _getStoredToken(AppConstants.refreshTokenKey);
    if (storedRefreshToken == null || storedRefreshToken.isEmpty) {
      return null;
    }

    try {
      final response = await _tokenDio.post(
        '/auth/refresh',
        data: {
          'refresh_token': storedRefreshToken,
        },
      );

      final data = response.data as Map<String, dynamic>;
      final newAccessToken = data['access_token'] as String;
      final newRefreshToken = data['refresh_token'] as String?;
      final userData = data['user'] as Map<String, dynamic>?;

      _cachedAccessToken = newAccessToken;
      await _storeToken(AppConstants.accessTokenKey, newAccessToken);
      if (newRefreshToken != null) {
        await _storeToken(AppConstants.refreshTokenKey, newRefreshToken);
      }
      if (userData != null) {
        _currentUser = User.fromJson(userData);
      }

      return newAccessToken;
    } catch (e) {
      return null;
    }
  }

  Future<User> register({
    required String fullName,
    required String email,
    required String password,
    required String rollNumber,
    required String batchYear,
    String? gender,
  }) async {
    final response = await _dio.post(
      '/auth/register',
      data: {
        'full_name': fullName.trim(),
        'email': email.trim().toLowerCase(),
        'password': password,
        'roll_number': rollNumber.trim().toUpperCase(),
        'batch_year': batchYear,
        'gender': gender,
      },
    );

    final userData = response.data as Map<String, dynamic>;
    return User.fromJson(userData);
  }

  Future<User?> checkSession() async {
    final token = await _getStoredToken(AppConstants.accessTokenKey);
    final refreshTok = await _getStoredToken(AppConstants.refreshTokenKey);

    if (token == null && refreshTok == null) return null;

    if (token != null) {
      _cachedAccessToken = token;
      try {
        final response = await _dio.get('/auth/me');
        _currentUser = User.fromJson(response.data as Map<String, dynamic>);
        return _currentUser;
      } catch (e) {
        // Access token might be expired; attempt refresh below
      }
    }

    // Try refreshing token if access token failed or was missing
    if (refreshTok != null) {
      final newAccessToken = await refreshToken();
      if (newAccessToken != null) {
        try {
          final response = await _dio.get('/auth/me');
          _currentUser = User.fromJson(response.data as Map<String, dynamic>);
          return _currentUser;
        } catch (_) {}
      }
    }

    // Failed both access token and refresh token: clean up
    await _clearStoredTokens();
    _cachedAccessToken = null;
    _currentUser = null;
    return null;
  }

  Future<void> logout() async {
    _cachedAccessToken = null;
    _currentUser = null;
    await _clearStoredTokens();
  }


  // --- Albums ---

  Future<List<Album>> getAlbums({String? academicYear, String? category}) async {
    final queryParams = <String, dynamic>{};
    if (academicYear != null && academicYear != 'All') {
      queryParams['academic_year'] = academicYear;
    }
    if (category != null && category != 'All') {
      queryParams['category'] = category;
    }

    final response = await _dio.get('/albums', queryParameters: queryParams);
    final list = response.data as List<dynamic>;
    return list.map((item) => Album.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Album> createAlbum({
    required String title,
    String? description,
    required String academicYear,
    required String category,
    DateTime? eventDate,
    String visibilityScope = 'BATCH_WIDE',
  }) async {
    final response = await _dio.post(
      '/albums',
      data: {
        'title': title,
        'description': description,
        'academic_year': academicYear,
        'category': category,
        'event_date': eventDate?.toIso8601String(),
        'visibility_scope': visibilityScope,
      },
    );
    return Album.fromJson(response.data as Map<String, dynamic>);
  }

  // --- Media & S3 Direct Uploads ---

  Future<List<MediaItem>> getAlbumMedia(String albumId) async {
    final response = await _dio.get('/media/album/$albumId');
    final list = response.data as List<dynamic>;
    return list.map((item) => MediaItem.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<Map<String, dynamic>> presignUpload({
    required String albumId,
    required String fileName,
    required int fileSizeBytes,
    required String mimeType,
    required String sha256Hash,
  }) async {
    final response = await _dio.post(
      '/media/presign-upload',
      data: {
        'album_id': albumId,
        'file_name': fileName,
        'file_size_bytes': fileSizeBytes,
        'mime_type': mimeType,
        'sha256_hash': sha256Hash,
      },
    );
    return response.data as Map<String, dynamic>;
  }

  Future<void> uploadBytesToS3({
    required String uploadUrl,
    required Uint8List bytes,
    required String mimeType,
    void Function(int sent, int total)? onProgress,
  }) async {
    final directDio = Dio();
    await directDio.put(
      uploadUrl,
      data: Stream.fromIterable([bytes]),
      options: Options(
        headers: {
          'Content-Type': mimeType,
          'Content-Length': bytes.length,
        },
      ),
      onSendProgress: onProgress,
    );
  }

  Future<MediaItem> confirmUpload({
    required String albumId,
    required String originalS3Key,
    required String fileName,
    required String mimeType,
    required int fileSizeBytes,
    required String sha256Hash,
    int? width,
    int? height,
    int? durationSeconds,
    DateTime? takenAt,
  }) async {
    final response = await _dio.post(
      '/media/confirm-upload',
      data: {
        'album_id': albumId,
        'original_s3_key': originalS3Key,
        'file_name': fileName,
        'mime_type': mimeType,
        'file_size_bytes': fileSizeBytes,
        'sha256_hash': sha256Hash,
        'width': width,
        'height': height,
        'duration_seconds': durationSeconds,
        'taken_at': takenAt?.toIso8601String(),
      },
    );
    return MediaItem.fromJson(response.data as Map<String, dynamic>);
  }

  // --- Admin ---

  Future<List<User>> getPendingUsers() async {
    final response = await _dio.get('/admin/pending-users');
    final list = response.data as List<dynamic>;
    return list.map((item) => User.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<User> approveUser(String userId) async {
    final response = await _dio.post('/admin/users/$userId/approve');
    return User.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> rejectUser(String userId) async {
    await _dio.post('/admin/users/$userId/reject');
  }

  Future<List<User>> getAllUsers() async {
    final response = await _dio.get('/admin/users');
    final list = response.data as List<dynamic>;
    return list.map((item) => User.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<List<Map<String, dynamic>>> getAuditLogs({int limit = 50}) async {
    final response = await _dio.get('/admin/audit-logs', queryParameters: {'limit': limit});
    return (response.data as List<dynamic>).cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> getTelemetry() async {
    final response = await _dio.get('/admin/telemetry');
    return response.data as Map<String, dynamic>;
  }
}

final apiService = ApiService();
