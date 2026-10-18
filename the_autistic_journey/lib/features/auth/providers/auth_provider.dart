import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../../models/user_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/constants/app_constants.dart';

/// Authentication state for the app.
enum AuthStatus {
  initial,
  loading,
  authenticated,
  unauthenticated,
  pendingApproval,
  suspended,
  error,
}

class AuthState {
  final AuthStatus status;
  final User? user;
  final String? errorMessage;

  const AuthState({
    this.status = AuthStatus.initial,
    this.user,
    this.errorMessage,
  });

  AuthState copyWith({
    AuthStatus? status,
    User? user,
    String? errorMessage,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class AuditRecord {
  final String action;
  final String actor;
  final String target;
  final String time;
  final String status;

  const AuditRecord({
    required this.action,
    required this.actor,
    required this.target,
    required this.time,
    this.status = 'SUCCESS',
  });
}

class UserManagementState {
  final List<User> pendingUsers;
  final List<User> allUsers;
  final List<AuditRecord> auditLogs;
  final Map<String, dynamic> telemetry;
  final bool isLoading;

  const UserManagementState({
    this.pendingUsers = const [],
    this.allUsers = const [],
    this.auditLogs = const [],
    this.telemetry = const {},
    this.isLoading = false,
  });

  UserManagementState copyWith({
    List<User>? pendingUsers,
    List<User>? allUsers,
    List<AuditRecord>? auditLogs,
    Map<String, dynamic>? telemetry,
    bool? isLoading,
  }) {
    return UserManagementState(
      pendingUsers: pendingUsers ?? this.pendingUsers,
      allUsers: allUsers ?? this.allUsers,
      auditLogs: auditLogs ?? this.auditLogs,
      telemetry: telemetry ?? this.telemetry,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class UserManagementNotifier extends StateNotifier<UserManagementState> {
  UserManagementNotifier() : super(const UserManagementState());

  Future<void> fetchPendingUsers() async {
    state = state.copyWith(isLoading: true);
    try {
      final pending = await apiService.getPendingUsers();
      state = state.copyWith(pendingUsers: pending, isLoading: false);
    } catch (_) {
      state = state.copyWith(isLoading: false);
    }
  }

  Future<void> fetchAllUsers() async {
    try {
      final users = await apiService.getAllUsers();
      state = state.copyWith(allUsers: users);
    } catch (_) {}
  }

  Future<void> fetchTelemetry() async {
    try {
      final data = await apiService.getTelemetry();
      state = state.copyWith(telemetry: data);
    } catch (_) {}
  }

  Future<void> fetchAuditLogs() async {
    try {
      final logs = await apiService.getAuditLogs();
      final records = logs.map((l) => AuditRecord(
        action: l['action'] as String? ?? 'SYSTEM_EVENT',
        actor: l['actor'] as String? ?? 'System',
        target: l['target'] as String? ?? '',
        time: l['time'] as String? ?? 'Recently',
        status: l['status'] as String? ?? 'SUCCESS',
      )).toList();
      state = state.copyWith(auditLogs: records);
    } catch (_) {}
  }

  Future<void> approveUser(String userId, String adminName) async {
    try {
      final updatedUser = await apiService.approveUser(userId);
      state = state.copyWith(
        pendingUsers: state.pendingUsers.where((u) => u.id != userId).toList(),
        allUsers: state.allUsers.map((u) => u.id == userId ? updatedUser : u).toList(),
        auditLogs: [
          AuditRecord(
            action: 'USER_APPROVED',
            actor: adminName,
            target: 'User $userId',
            time: 'Just now',
          ),
          ...state.auditLogs,
        ],
      );
    } catch (_) {}
  }

  Future<void> rejectUser(String userId, String adminName) async {
    try {
      await apiService.rejectUser(userId);
      state = state.copyWith(
        pendingUsers: state.pendingUsers.where((u) => u.id != userId).toList(),
        allUsers: state.allUsers.where((u) => u.id != userId).toList(),
        auditLogs: [
          AuditRecord(
            action: 'USER_REJECTED',
            actor: adminName,
            target: 'User $userId',
            time: 'Just now',
            status: 'REJECTED',
          ),
          ...state.auditLogs,
        ],
      );
    } catch (_) {}
  }
}

final userManagementProvider =
    StateNotifierProvider<UserManagementNotifier, UserManagementState>((ref) {
  return UserManagementNotifier();
});

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref ref;

  AuthNotifier(this.ref) : super(const AuthState(status: AuthStatus.initial)) {
    // Listen for global session expiration from apiService
    apiService.onSessionExpired = () {
      state = const AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Session expired. Please log in again.',
      );
    };
    // Automatically check existing session on initialization
    checkSession();
  }

  /// Log in with email and password via backend API.
  Future<void> login(String email, String password) async {
    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);

    try {
      final user = await apiService.login(email, password);

      if (user.status == 'PENDING_APPROVAL') {
        state = state.copyWith(
          status: AuthStatus.pendingApproval,
          user: user,
        );
      } else if (user.status == 'SUSPENDED') {
        state = state.copyWith(
          status: AuthStatus.suspended,
          user: user,
          errorMessage: 'Your account has been suspended by an administrator.',
        );
      } else {
        state = state.copyWith(
          status: AuthStatus.authenticated,
          user: user,
        );
      }
    } on DioException catch (e) {
      final responseData = e.response?.data;
      String message = 'Authentication failed. Please verify your email and password.';
      if (responseData is Map<String, dynamic> && responseData['detail'] != null) {
        message = responseData['detail'].toString();
      } else if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        message =
            'Unable to reach server (${AppConstants.baseApiUrl}). Please check your internet connection.';
      } else if (e.message != null && e.message!.isNotEmpty) {
        message = e.message!;
      }

      if (e.response?.statusCode == 403 && message.contains('approval')) {
        state = state.copyWith(
          status: AuthStatus.pendingApproval,
          errorMessage: message,
        );
      } else {
        state = state.copyWith(
          status: AuthStatus.error,
          errorMessage: message,
        );
      }
    } catch (e) {
      state = state.copyWith(
        status: AuthStatus.error,
        errorMessage: 'Connection failed: $e',
      );
    }
  }

  /// Register a new batch student account (FR-A01, FR-A02).
  Future<void> register({
    required String fullName,
    required String email,
    required String password,
    required String rollNumber,
    required String batchYear,
    String? gender,
  }) async {
    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);

    try {
      final user = await apiService.register(
        fullName: fullName,
        email: email,
        password: password,
        rollNumber: rollNumber,
        batchYear: batchYear,
        gender: gender,
      );

      // Post-registration status is PENDING_APPROVAL (FR-A02)
      state = state.copyWith(
        status: AuthStatus.pendingApproval,
        user: user,
      );
    } on DioException catch (e) {
      final responseData = e.response?.data;
      String message = 'Registration failed. Please try again.';
      if (responseData is Map<String, dynamic> && responseData['detail'] != null) {
        message = responseData['detail'].toString();
      }
      state = state.copyWith(
        status: AuthStatus.error,
        errorMessage: message,
      );
    } catch (e) {
      state = state.copyWith(
        status: AuthStatus.error,
        errorMessage: 'Registration error: $e',
      );
    }
  }

  /// Log out current user and purge secure tokens.
  Future<void> logout() async {
    await apiService.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Check active session on app startup.
  Future<void> checkSession() async {
    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);
    try {
      final user = await apiService.checkSession();
      if (user != null) {
        if (user.status == 'PENDING_APPROVAL') {
          state = state.copyWith(status: AuthStatus.pendingApproval, user: user);
        } else if (user.status == 'SUSPENDED') {
          state = state.copyWith(
            status: AuthStatus.suspended,
            user: user,
            errorMessage: 'Your account has been suspended by an administrator.',
          );
        } else {
          state = state.copyWith(status: AuthStatus.authenticated, user: user);
        }
      } else {
        state = const AuthState(status: AuthStatus.unauthenticated);
      }
    } catch (_) {
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }
}

/// Global auth state provider.
final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});

