import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../../core/theme/app_theme_tokens.dart';
import 'package:the_autistic_journey/models/user_model.dart';
import 'package:the_autistic_journey/features/auth/providers/auth_provider.dart';

/// Admin & Moderation Console (FR-M01, FR-M02, FR-M03, FR-M04).
/// Features registration approval queue, student directory, audit log ledger,
/// and S3 storage metrics designed in high-contrast brutalist aesthetics.
class AdminDashboardScreen extends ConsumerStatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  ConsumerState<AdminDashboardScreen> createState() =>
      _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends ConsumerState<AdminDashboardScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _directorySearchController = TextEditingController();
  String _directorySearchQuery = '';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _directorySearchController.addListener(() {
      setState(() {
        _directorySearchQuery = _directorySearchController.text.trim().toLowerCase();
      });
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(userManagementProvider.notifier).fetchPendingUsers();
      ref.read(userManagementProvider.notifier).fetchAllUsers();
      ref.read(userManagementProvider.notifier).fetchAuditLogs();
      ref.read(userManagementProvider.notifier).fetchTelemetry();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _directorySearchController.dispose();
    super.dispose();
  }


  void _approveUser(String id, String name) {
    final adminName = ref.read(authProvider).user?.fullName ?? 'Administrator';
    ref.read(userManagementProvider.notifier).approveUser(id, adminName);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Verified & approved $name for batch vault access.'),
      ),
    );
  }

  void _rejectUser(String id, String name) {
    final adminName = ref.read(authProvider).user?.fullName ?? 'Administrator';
    ref.read(userManagementProvider.notifier).rejectUser(id, adminName);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Rejected registration for $name.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final isWide = MediaQuery.of(context).size.width > 900;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: NestedScrollView(
        headerSliverBuilder: (context, innerBoxIsScrolled) {
          return [
            SliverToBoxAdapter(
              child: _buildHeader(user, isWide),
            ),
            SliverToBoxAdapter(
              child: _buildTelemetryStats(isWide),
            ),
            SliverPersistentHeader(
              pinned: true,
              delegate: _TabBarHeaderDelegate(
                TabBar(
                  controller: _tabController,
                  isScrollable: !isWide,
                  indicatorColor: AppColors.textPrimary,
                  indicatorWeight: 2,
                  labelColor: AppColors.textPrimary,
                  unselectedLabelColor: AppColors.mercuryDark,
                  labelStyle: AppTextStyles.labelSmall.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                  unselectedLabelStyle: AppTextStyles.labelSmall,
                  tabs: [
                    Tab(
                      text:
                          'PENDING APPROVALS (${ref.watch(userManagementProvider).pendingUsers.length})',
                    ),
                    const Tab(text: 'STUDENT DIRECTORY'),
                    const Tab(text: 'AUDIT LEDGER'),
                    const Tab(text: 'SYSTEM STORAGE'),
                  ],
                ),
              ),
            ),
          ];
        },
        body: TabBarView(
          controller: _tabController,
          children: [
            _buildApprovalsTab(isWide),
            _buildDirectoryTab(isWide),
            _buildAuditTab(isWide),
            _buildStorageTab(isWide),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(User? user, bool isWide) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: 32,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: AppColors.divider, width: 0.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                color: AppColors.accentWarm.withValues(alpha: 0.15),
                child: Text(
                  'ROLE: ${user?.role.toUpperCase() ?? "SUPER_ADMIN"}',
                  style: AppTextStyles.labelSmall.copyWith(
                    color: AppColors.accentWarm,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Text('//', style: AppTextStyles.labelSmall),
              const SizedBox(width: 12),
              Text(
                'GOVERNANCE CONSOLE',
                style: AppTextStyles.labelSmall.copyWith(
                  color: AppColors.mercuryDark,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'ADMIN COMMAND.',
            style: isWide
                ? AppTextStyles.displayMedium.copyWith(fontSize: 36)
                : AppTextStyles.headlineLarge.copyWith(fontSize: 26),
          ),
          const SizedBox(height: 8),
          Text(
            'Approve classmate registrations, verify institutional integrity, and oversee batch archive vaults.',
            style: AppTextStyles.bodySmall.copyWith(color: AppColors.textDim),
          ),
        ],
      ),
    );
  }

  Widget _buildTelemetryStats(bool isWide) {
    final mgmtState = ref.watch(userManagementProvider);
    final telemetry = mgmtState.telemetry;
    final totalBytes = (telemetry['total_bytes_stored'] as num?)?.toDouble() ?? 0.0;
    final totalMedia = (telemetry['total_media_count'] as num?)?.toInt() ?? 0;
    final activeCount = (telemetry['active_users_count'] as num?)?.toInt() ??
        mgmtState.allUsers.where((u) => u.isActive).length;
    final pendingCount = (telemetry['pending_users_count'] as num?)?.toInt() ??
        mgmtState.pendingUsers.length;

    String storageStr = '${(totalBytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
    if (totalBytes < 1024 * 1024 * 1024) {
      storageStr = '${(totalBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: 20,
      ),
      color: AppColors.surfaceElevated,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _buildStatBlock(
            'VERIFIED CLASSMATES',
            '$activeCount',
            'Active Batch Members',
          ),
          _buildStatBlock(
            'S3 VAULT USAGE',
            storageStr,
            '$totalMedia Archival Assets',
          ),
          _buildStatBlock(
            'PENDING APPROVAL',
            '$pendingCount',
            pendingCount == 0 ? 'Queue Clear' : 'Awaiting verification',
          ),
          if (isWide)
            _buildStatBlock('SYSTEM STATUS', 'HEALTHY', 'Vault API Online'),
        ],
      ),
    );
  }


  Widget _buildStatBlock(String label, String value, String sub) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppTextStyles.labelSmall.copyWith(
            fontSize: 8,
            color: AppColors.mercuryDark,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontFamily: 'SpaceMono',
            fontWeight: FontWeight.w700,
            fontSize: 20,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          sub,
          style: AppTextStyles.labelSmall.copyWith(
            fontSize: 7,
            color: AppColors.textDim,
          ),
        ),
      ],
    );
  }

  Widget _buildApprovalsTab(bool isWide) {
    final pendingUsers = ref.watch(userManagementProvider).pendingUsers;
    if (pendingUsers.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.verified_user_outlined,
              size: 48,
              color: AppColors.accentSuccess,
            ),
            const SizedBox(height: 16),
            Text(
              'QUEUE CLEAR // ZERO PENDING',
              style: AppTextStyles.labelMedium.copyWith(
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'All student registrations have been vetted and approved.',
              style: AppTextStyles.bodySmall.copyWith(color: AppColors.textDim),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: 24,
      ),
      itemCount: pendingUsers.length,
      separatorBuilder: (_, index) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final u = pendingUsers[index];
        return Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            border: Border.all(color: AppColors.border, width: 0.5),
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: AppColors.surfaceOverlay,
                child: Text(
                  u.fullName.isNotEmpty ? u.fullName.substring(0, 1) : 'U',
                  style: const TextStyle(
                    fontFamily: 'SpaceMono',
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      u.fullName,
                      style: AppTextStyles.bodyMedium.copyWith(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'ROLL: ${u.rollNumber ?? "N/A"} • BATCH: ${u.batchYear} • GENDER: ${u.gender ?? "N/A"}',
                      style: AppTextStyles.labelSmall.copyWith(
                        fontSize: 8,
                        color: AppColors.mercuryDark,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      u.email,
                      style: AppTextStyles.bodySmall.copyWith(
                        fontSize: 11,
                        color: AppColors.textDim,
                      ),
                    ),
                  ],
                ),
              ),
              OutlinedButton(
                onPressed: () => _rejectUser(u.id, u.fullName),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.accentDanger,
                  side: const BorderSide(color: AppColors.accentDanger, width: 0.5),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                ),
                child: const Text('REJECT'),
              ),
              const SizedBox(width: 12),
              ElevatedButton(
                onPressed: () => _approveUser(u.id, u.fullName),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 10,
                  ),
                ),
                child: const Text('APPROVE'),
              ),
            ],
          ),
        ).animate().fadeIn(duration: 250.ms, delay: (index * 40).ms);
      },
    );
  }

  Widget _buildDirectoryTab(bool isWide) {
    final allUsers = ref.watch(userManagementProvider).allUsers;
    final filteredUsers = allUsers.where((u) {
      if (_directorySearchQuery.isEmpty) return true;
      final query = _directorySearchQuery;
      return u.fullName.toLowerCase().contains(query) ||
          u.email.toLowerCase().contains(query) ||
          (u.rollNumber?.toLowerCase().contains(query) ?? false);
    }).toList();

    return Column(
      children: [
        // Search & Count Bar
        Padding(
          padding: EdgeInsets.fromLTRB(
            isWide ? 40 : 20,
            20,
            isWide ? 40 : 20,
            12,
          ),
          child: Row(
            children: [
              Expanded(
                child: Container(
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceCard,
                    border: Border.all(color: AppColors.border, width: 0.5),
                  ),
                  child: TextField(
                    controller: _directorySearchController,
                    style: AppTextStyles.bodyMedium,
                    decoration: InputDecoration(
                      hintText: 'FILTER BY NAME, ROLL NO, OR EMAIL...',
                      hintStyle: AppTextStyles.labelSmall.copyWith(
                        color: AppColors.textDim,
                        fontSize: 9,
                      ),
                      prefixIcon: const Icon(
                        Icons.search,
                        size: 16,
                        color: AppColors.mercuryDark,
                      ),
                      suffixIcon: _directorySearchQuery.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, size: 14),
                              onPressed: () => _directorySearchController.clear(),
                            )
                          : null,
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Container(
                height: 44,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                color: AppColors.surfaceElevated,
                alignment: Alignment.center,
                child: Text(
                  'TOTAL: ${allUsers.length}',
                  style: AppTextStyles.labelSmall.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
        ),

        // Student List
        Expanded(
          child: filteredUsers.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.folder_shared_outlined,
                        size: 40,
                        color: AppColors.mercuryDark,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _directorySearchQuery.isEmpty
                            ? 'NO REGISTERED STUDENTS'
                            : 'NO STUDENTS MATCH "$_directorySearchQuery"',
                        style: AppTextStyles.labelSmall.copyWith(
                          color: AppColors.textDim,
                        ),
                      ),
                    ],
                  ),
                )
              : ListView.separated(
                  padding: EdgeInsets.symmetric(
                    horizontal: isWide ? 40 : 20,
                    vertical: 12,
                  ),
                  itemCount: filteredUsers.length,
                  separatorBuilder: (context, index) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {

                    final student = filteredUsers[index];
                    final isActive = student.isActive;
                    final isPending = student.isPending;

                    return Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceCard,
                        border: Border.all(
                          color: isActive
                              ? AppColors.border
                              : AppColors.accentWarm.withValues(alpha: 0.3),
                          width: 0.5,
                        ),
                      ),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 18,
                            backgroundColor: AppColors.surfaceOverlay,
                            child: Text(
                              student.fullName.isNotEmpty
                                  ? student.fullName.substring(0, 1).toUpperCase()
                                  : 'S',
                              style: const TextStyle(
                                fontFamily: 'SpaceMono',
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      student.fullName,
                                      style: AppTextStyles.bodyMedium.copyWith(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                        vertical: 2,
                                      ),
                                      color: isPending
                                          ? AppColors.accentWarm.withValues(alpha: 0.15)
                                          : AppColors.accentSuccess.withValues(alpha: 0.15),
                                      child: Text(
                                        student.status,
                                        style: TextStyle(
                                          fontFamily: 'SpaceMono',
                                          fontSize: 8,
                                          fontWeight: FontWeight.w700,
                                          color: isPending
                                              ? AppColors.accentWarm
                                              : AppColors.accentSuccess,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'ROLL: ${student.rollNumber ?? "N/A"} • BATCH: ${student.batchYear} • ROLE: ${student.role}',
                                  style: AppTextStyles.labelSmall.copyWith(
                                    fontSize: 8,
                                    color: AppColors.mercuryDark,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  student.email,
                                  style: AppTextStyles.bodySmall.copyWith(
                                    fontSize: 11,
                                    color: AppColors.textDim,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildAuditTab(bool isWide) {
    final auditLogs = ref.watch(userManagementProvider).auditLogs;
    return ListView.separated(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: 24,
      ),
      itemCount: auditLogs.length,
      separatorBuilder: (_, index) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final log = auditLogs[index];
        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            border: Border.all(color: AppColors.border, width: 0.5),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                color: AppColors.surfaceOverlay,
                child: Text(
                  log.action,
                  style: AppTextStyles.labelSmall.copyWith(
                    fontSize: 8,
                    color: AppColors.accent,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'ACTOR: ${log.actor}',
                      style: AppTextStyles.bodySmall.copyWith(
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'TARGET: ${log.target}',
                      style: AppTextStyles.labelSmall.copyWith(
                        fontSize: 8,
                        color: AppColors.textDim,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                log.time,
                style: AppTextStyles.labelSmall.copyWith(
                  fontSize: 8,
                  color: AppColors.mercuryDark,
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStorageTab(bool isWide) {
    final telemetry = ref.watch(userManagementProvider).telemetry;
    final totalBytes = (telemetry['total_bytes_stored'] as num?)?.toDouble() ?? 0.0;
    final totalMedia = (telemetry['total_media_count'] as num?)?.toInt() ?? 0;
    final totalAlbums = (telemetry['total_albums_count'] as num?)?.toInt() ?? 4;
    final bucket = telemetry['storage_bucket'] as String? ?? 'the-autistic-journey-media-vault';
    final region = telemetry['region'] as String? ?? 'ap-south-1';
    final percent = (telemetry['percent_utilized'] as num?)?.toDouble() ?? 0.0;

    String storageStr = '${(totalBytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
    if (totalBytes < 1024 * 1024 * 1024) {
      storageStr = '${(totalBytes / (1024 * 1024)).toStringAsFixed(2)} MB';
    }

    return ListView(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: 24,
      ),
      children: [
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            border: Border.all(color: AppColors.border, width: 0.5),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'AWS CLOUD STORAGE TELEMETRY',
                style: AppTextStyles.labelMedium.copyWith(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 16),
              ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: (percent / 100.0).clamp(0.01, 1.0),
                  minHeight: 8,
                  backgroundColor: AppColors.surfaceOverlay,
                  valueColor: const AlwaysStoppedAnimation<Color>(AppColors.accent),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '$storageStr USED / 400 GB ALLOCATED',
                    style: AppTextStyles.labelSmall.copyWith(
                      color: AppColors.mercury,
                    ),
                  ),
                  Text(
                    '${percent.toStringAsFixed(1)}% CAPACITY',
                    style: AppTextStyles.labelSmall.copyWith(
                      color: AppColors.mercuryDark,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            border: Border.all(color: AppColors.border, width: 0.5),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'VAULT INFRASTRUCTURE DETAILS',
                style: AppTextStyles.labelSmall.copyWith(
                  color: AppColors.mercuryDark,
                  letterSpacing: 2,
                ),
              ),
              const SizedBox(height: 16),
              _buildDetailRow('S3 BUCKET', bucket),
              const Divider(color: AppColors.divider, height: 20),
              _buildDetailRow('AWS REGION', region),
              const Divider(color: AppColors.divider, height: 20),
              _buildDetailRow('TOTAL MEDIA OBJECTS', '$totalMedia items'),
              const Divider(color: AppColors.divider, height: 20),
              _buildDetailRow('TIMELINE ALBUMS', '$totalAlbums active'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Row(
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
    );
  }
}


class _TabBarHeaderDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;

  _TabBarHeaderDelegate(this.tabBar);

  @override
  Widget build(
      BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      color: AppColors.background,
      child: tabBar,
    );
  }

  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  double get minExtent => tabBar.preferredSize.height;

  @override
  bool shouldRebuild(covariant _TabBarHeaderDelegate oldDelegate) {
    return false;
  }
}
