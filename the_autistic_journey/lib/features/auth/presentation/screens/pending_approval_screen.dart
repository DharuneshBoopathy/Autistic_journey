import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../../core/theme/app_theme_tokens.dart';
import '../../providers/auth_provider.dart';

/// Pending approval screen (FR-A02) shown after registration.
class PendingApprovalScreen extends ConsumerWidget {
  const PendingApprovalScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Animated clock icon
              Container(
                width: 100,
                height: 100,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: AppColors.statusPending.withValues(alpha: 0.3),
                    width: 2,
                  ),
                ),
                child: const Icon(
                  Icons.hourglass_top_rounded,
                  size: 48,
                  color: AppColors.statusPending,
                ),
              )
                  .animate(onPlay: (c) => c.repeat(reverse: true))
                  .rotate(begin: 0, end: 0.02, duration: 2.seconds)
                  .then()
                  .rotate(begin: 0.02, end: -0.02, duration: 2.seconds),

              const SizedBox(height: 40),

              Text(
                'AWAITING CLEARANCE',
                style: AppTextStyles.headlineLarge.copyWith(
                  letterSpacing: 4,
                ),
              ).animate().fadeIn(duration: 800.ms, delay: 200.ms),

              const SizedBox(height: 16),

              Text(
                'Your archive access request has been submitted.\nA batch administrator will review and approve your registration.',
                textAlign: TextAlign.center,
                style: AppTextStyles.bodyMedium,
              ).animate().fadeIn(duration: 600.ms, delay: 400.ms),

              if (user != null) ...[
                const SizedBox(height: 32),
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceCard,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Column(
                    children: [
                      _infoRow('NAME', user.fullName),
                      const SizedBox(height: 12),
                      _infoRow('EMAIL', user.email),
                      const SizedBox(height: 12),
                      _infoRow('ROLL NO', user.rollNumber ?? 'N/A'),
                      const SizedBox(height: 12),
                      _infoRow('BATCH', user.batchYear),
                    ],
                  ),
                ).animate().fadeIn(duration: 600.ms, delay: 600.ms),
              ],

              const SizedBox(height: 40),

              OutlinedButton(
                onPressed: () => ref.read(authProvider.notifier).logout(),
                child: const Text('RETURN TO LOGIN'),
              ).animate().fadeIn(duration: 400.ms, delay: 800.ms),
            ],
          ),
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTextStyles.labelSmall),
        Text(
          value,
          style: AppTextStyles.bodySmall.copyWith(
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }
}
