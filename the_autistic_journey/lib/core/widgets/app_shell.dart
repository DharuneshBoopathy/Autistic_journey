import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_theme_tokens.dart';
import '../../features/auth/providers/auth_provider.dart';

/// Nite Riot-inspired app shell with top navigation bar.
/// Features: location/time display on left, nav items centered, brand logo at center top.
class AppShell extends ConsumerStatefulWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _selectedIndex = 0;

  final List<_NavDestination> _destinations = [
    _NavDestination(label: 'GALLERY', path: '/gallery', icon: Icons.grid_view_rounded),
    _NavDestination(label: 'UPLOAD', path: '/upload', icon: Icons.cloud_upload_outlined),
    _NavDestination(label: 'ADMIN', path: '/admin', icon: Icons.admin_panel_settings_outlined),
    _NavDestination(label: 'PROFILE', path: '/profile', icon: Icons.person_outline_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final isWide = MediaQuery.of(context).size.width > 900;

    final currentPath = GoRouterState.of(context).matchedLocation;

    if (authState.status == AuthStatus.initial || authState.status == AuthStatus.loading) {
      return const Scaffold(
        backgroundColor: AppColors.background,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.textPrimary,
                ),
              ),
              SizedBox(height: 20),
              Text(
                'AUTHENTICATING SESSION // ARCHIVE VAULT',
                style: TextStyle(
                  fontFamily: 'SpaceMono',
                  fontSize: 11,
                  letterSpacing: 2,
                  color: AppColors.mercuryDark,
                ),
              ),
            ],
          ),
        ),
      );
    }


    // Update selected index based on current route
    for (int i = 0; i < _destinations.length; i++) {
      if (currentPath.startsWith(_destinations[i].path)) {
        _selectedIndex = i;
        break;
      }
    }

    // Filter destinations based on role
    final visibleDestinations = _destinations.where((d) {
      if (d.label == 'ADMIN') {
        return user?.isSuperAdmin == true || user?.isModerator == true;
      }
      return true;
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          // -- Top Navigation Bar (Nite Riot style) --
          if (isWide) _buildDesktopNav(context, visibleDestinations, currentPath),
          
          // -- Content --
          Expanded(child: widget.child),
        ],
      ),
      // -- Bottom Nav for mobile --
      bottomNavigationBar: isWide
          ? null
          : _buildMobileBottomNav(context, visibleDestinations),
    );
  }

  Widget _buildDesktopNav(BuildContext context, List<_NavDestination> destinations, String currentPath) {
    final now = DateTime.now();
    final timeStr = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 32),
      decoration: const BoxDecoration(
        color: AppColors.background,
        border: Border(
          bottom: BorderSide(color: AppColors.divider, width: 0.5),
        ),
      ),
      child: Row(
        children: [
          // Left: Location & Time (Nite Riot style)
          Text(
            'BATCH 2023-2027',
            style: AppTextStyles.labelSmall.copyWith(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(width: 16),
          Text('//', style: AppTextStyles.labelSmall),
          const SizedBox(width: 16),
          Text(
            '● $timeStr',
            style: AppTextStyles.labelSmall.copyWith(
              color: AppColors.textSecondary,
            ),
          ),
          
          const Spacer(),

          // Center: Nav items
          ...destinations.map((dest) {
            final isActive = currentPath.startsWith(dest.path);
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: InkWell(
                onTap: () => context.go(dest.path),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      dest.label,
                      style: AppTextStyles.navItem.copyWith(
                        color: isActive 
                            ? AppColors.textPrimary 
                            : AppColors.textDim,
                      ),
                    ),
                    const SizedBox(height: 2),
                    AnimatedContainer(
                      duration: AppDurations.fast,
                      height: 2,
                      width: isActive ? 20 : 0,
                      decoration: BoxDecoration(
                        color: AppColors.accent,
                        borderRadius: BorderRadius.circular(1),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),

          const Spacer(),

          // Right: Brand logo
          Text(
            'TAJ',
            style: AppTextStyles.headlineMedium.copyWith(
              fontSize: 18,
              letterSpacing: 4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMobileBottomNav(
      BuildContext context, List<_NavDestination> destinations) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: AppColors.divider, width: 0.5),
        ),
      ),
      child: SafeArea(
        child: SizedBox(
          height: 64,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: destinations.asMap().entries.map((entry) {
              final index = entry.key;
              final dest = entry.value;
              final isActive = _selectedIndex == index;

              return Expanded(
                child: InkWell(
                  onTap: () {
                    setState(() => _selectedIndex = index);
                    context.go(dest.path);
                  },
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        dest.icon,
                        size: 22,
                        color: isActive
                            ? AppColors.accent
                            : AppColors.mercuryDark,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        dest.label,
                        style: TextStyle(
                          fontFamily: 'SpaceMono',
                          fontSize: 9,
                          letterSpacing: 1.5,
                          fontWeight:
                              isActive ? FontWeight.w700 : FontWeight.w400,
                          color: isActive
                              ? AppColors.accent
                              : AppColors.mercuryDark,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ),
      ),
    );
  }
}

class _NavDestination {
  final String label;
  final String path;
  final IconData icon;

  const _NavDestination({
    required this.label,
    required this.path,
    required this.icon,
  });
}
