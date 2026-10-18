import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/register_screen.dart';
import '../../features/auth/presentation/screens/pending_approval_screen.dart';
import '../../features/gallery/presentation/screens/gallery_home_screen.dart';
import '../../features/album/presentation/screens/album_detail_screen.dart';
import '../../features/lightbox/presentation/lightbox_screen.dart';
import '../../features/upload/presentation/screens/upload_screen.dart';
import '../../features/admin/presentation/screens/admin_dashboard_screen.dart';
import '../../features/profile/presentation/screens/profile_screen.dart';
import '../widgets/app_shell.dart';

class RouterNotifier extends ChangeNotifier {
  final Ref _ref;

  RouterNotifier(this._ref) {
    _ref.listen<AuthState>(
      authProvider,
      (previous, next) => notifyListeners(),
    );

  }
}

final routerNotifierProvider = Provider<RouterNotifier>((ref) {
  return RouterNotifier(ref);
});

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = ref.watch(routerNotifierProvider);

  return GoRouter(
    initialLocation: '/gallery',
    refreshListenable: notifier,
    redirect: (context, state) {
      final authState = ref.read(authProvider);
      final isAuth = authState.status == AuthStatus.authenticated;
      final isPending = authState.status == AuthStatus.pendingApproval;
      final isInitialOrLoading = authState.status == AuthStatus.initial ||
          authState.status == AuthStatus.loading;
      final isLoginRoute = state.matchedLocation == '/login';
      final isRegisterRoute = state.matchedLocation == '/register';
      final isPendingRoute = state.matchedLocation == '/pending';

      // 1. While checking session on launch:
      if (isInitialOrLoading) {
        // If user explicitly navigated to /login or /register, let them view it
        if (isLoginRoute || isRegisterRoute) return null;
        // Don't prematurely kick user from deep link before session check finishes
        return null;
      }

      // 2. Pending approval gate
      if (isPending && !isPendingRoute) return '/pending';

      // 3. Unauthenticated gate
      if (!isAuth && !isLoginRoute && !isRegisterRoute && !isPendingRoute) {
        return '/login';
      }

      // 4. Authenticated user attempting to visit login/register/pending
      if (isAuth && (isLoginRoute || isRegisterRoute || isPendingRoute)) {
        return '/gallery';
      }

      // 5. Admin console role protection (FR-M01)
      if (state.matchedLocation.startsWith('/admin')) {
        final user = authState.user;
        final isAdmin = user?.isSuperAdmin == true || user?.isModerator == true;
        if (!isAdmin) {
          return '/gallery';
        }
      }

      return null;
    },

    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/pending',
        builder: (context, state) => const PendingApprovalScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/gallery',
            builder: (context, state) => const GalleryHomeScreen(),
          ),
          GoRoute(
            path: '/album/:albumId',
            builder: (context, state) {
              final albumId = state.pathParameters['albumId']!;
              final albumTitle =
                  state.uri.queryParameters['title'] ?? 'Album';
              return AlbumDetailScreen(
                albumId: albumId,
                albumTitle: albumTitle,
              );
            },
          ),
          GoRoute(
            path: '/upload',
            builder: (context, state) => const UploadScreen(),
          ),
          GoRoute(
            path: '/admin',
            builder: (context, state) => const AdminDashboardScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfileScreen(),
          ),
        ],
      ),
      GoRoute(
        path: '/lightbox',
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>?;
          return LightboxScreen(
            imageUrl: extra?['imageUrl'] as String? ?? '',
            heroTag: extra?['heroTag'] as String? ?? '',
            title: extra?['title'] as String? ?? '',
          );
        },
      ),
    ],
  );
});
