import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme_tokens.dart';
import 'package:the_autistic_journey/features/auth/providers/auth_provider.dart';

/// User Profile Screen with account details, batch credentials,
/// upload contribution statistics, security controls, and logout action.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final isWide = MediaQuery.of(context).size.width > 900;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        padding: EdgeInsets.symmetric(
          horizontal: isWide ? 60 : 20,
          vertical: 36,
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top Header
                Text(
                  'VAULT CREDENTIALS',
                  style: AppTextStyles.labelSmall.copyWith(
                    letterSpacing: 3,
                    color: AppColors.mercuryDark,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'IDENTITY PROFILE.',
                  style: isWide
                      ? AppTextStyles.displayMedium.copyWith(fontSize: 38)
                      : AppTextStyles.headlineLarge.copyWith(fontSize: 26),
                ),

                const Divider(color: AppColors.divider, height: 48),

                // Main Identity Card
                Container(
                  padding: const EdgeInsets.all(28),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceCard,
                    border: Border.all(color: AppColors.border, width: 0.5),
                  ),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 64,
                            height: 64,
                            decoration: BoxDecoration(
                              color: AppColors.surfaceOverlay,
                              border: Border.all(
                                color: AppColors.mercury,
                                width: 1,
                              ),
                            ),
                            child: Center(
                              child: Text(
                                user?.fullName.isNotEmpty == true
                                    ? user!.fullName.substring(0, 1).toUpperCase()
                                    : 'U',
                                style: const TextStyle(
                                  fontFamily: 'SpaceMono',
                                  fontSize: 24,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textPrimary,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 20),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  user?.fullName ?? 'Verified Student',
                                  style: AppTextStyles.headlineSmall.copyWith(
                                    fontSize: 20,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  user?.email ?? 'student@college.edu.in',
                                  style: AppTextStyles.bodySmall.copyWith(
                                    color: AppColors.textDim,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 8,
                                        vertical: 3,
                                      ),
                                      color: AppColors.accentWarm.withValues(alpha: 0.15),
                                      child: Text(
                                        user?.role.toUpperCase() ?? 'VERIFIED_STUDENT',
                                        style: AppTextStyles.labelSmall.copyWith(
                                          fontSize: 8,
                                          color: AppColors.accentWarm,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 8,
                                        vertical: 3,
                                      ),
                                      color: AppColors.accentSuccess.withValues(alpha: 0.15),
                                      child: Text(
                                        'STATUS: ${user?.status.toUpperCase() ?? "APPROVED"}',
                                        style: AppTextStyles.labelSmall.copyWith(
                                          fontSize: 8,
                                          color: AppColors.accentSuccess,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const Divider(color: AppColors.divider, height: 40),
                      _buildDetailRow('INSTITUTIONAL ROLL NO', user?.rollNumber ?? '23CS042'),
                      _buildDetailRow('ACADEMIC BATCH YEAR', '${user?.batchYear ?? 2027} (4-Year B.E)'),
                      _buildDetailRow('REGISTERED GENDER', user?.gender ?? 'PREFER_NOT_TO_SAY'),
                      _buildDetailRow('ENCRYPTED USER ID', user?.id ?? 'usr-001'),
                    ],
                  ),
                ).animate().fadeIn(duration: 300.ms),

                const SizedBox(height: 32),

                // Vault Contribution Stats
                Text(
                  'CONTRIBUTION AUDIT',
                  style: AppTextStyles.labelSmall.copyWith(
                    letterSpacing: 2,
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _buildMetricTile(
                        label: 'MEDIA CONTRIBUTED',
                        value: '184',
                        subtext: 'Photos & 4K Clips',
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: _buildMetricTile(
                        label: 'VAULT STORAGE USED',
                        value: '4.8 GB',
                        subtext: 'Zero Compression',
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: _buildMetricTile(
                        label: 'ALBUMS TAGGED IN',
                        value: '14',
                        subtext: 'Batch Timeline & Trips',
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 36),

                // Security & Actions
                Text(
                  'SESSION SECURITY',
                  style: AppTextStyles.labelSmall.copyWith(
                    letterSpacing: 2,
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevated,
                    border: Border.all(color: AppColors.border, width: 0.5),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.lock_outline,
                        size: 20,
                        color: AppColors.mercuryDark,
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'PRIVATE SESSION ACTIVE',
                              style: AppTextStyles.bodySmall.copyWith(
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'JWT Bearer tokens stored in OS secure keychain memory.',
                              style: AppTextStyles.labelSmall.copyWith(
                                fontSize: 8,
                                color: AppColors.textDim,
                              ),
                            ),
                          ],
                        ),
                      ),
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.accentDanger.withValues(alpha: 0.15),
                          foregroundColor: AppColors.accentDanger,
                          side: const BorderSide(
                            color: AppColors.accentDanger,
                            width: 0.5,
                          ),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 12,
                          ),
                        ),
                        onPressed: () {
                          ref.read(authProvider.notifier).logout();
                          context.go('/login');
                        },
                        icon: const Icon(Icons.logout, size: 14),
                        label: const Text('TERMINATE SESSION'),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 48),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 9,
              color: AppColors.mercuryDark,
            ),
          ),
          Text(
            value,
            style: AppTextStyles.bodySmall.copyWith(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricTile({
    required String label,
    required String value,
    required String subtext,
  }) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 8,
              color: AppColors.mercuryDark,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              fontFamily: 'SpaceMono',
              fontWeight: FontWeight.w800,
              fontSize: 22,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtext,
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 8,
              color: AppColors.textDim,
            ),
          ),
        ],
      ),
    );
  }
}
