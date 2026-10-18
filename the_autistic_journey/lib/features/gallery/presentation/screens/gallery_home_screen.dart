import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../../../core/theme/app_theme_tokens.dart';
import '../../../../models/album_model.dart';
import 'package:the_autistic_journey/features/gallery/providers/gallery_provider.dart';

/// Nite Riot-inspired Editorial Gallery Home Screen.
/// Incorporates brutalist layout, DynamicFrameLayout hover aesthetics,
/// academic year chronology, and liquid mercury accenting.
class GalleryHomeScreen extends ConsumerStatefulWidget {
  const GalleryHomeScreen({super.key});

  @override
  ConsumerState<GalleryHomeScreen> createState() => _GalleryHomeScreenState();
}

class _GalleryHomeScreenState extends ConsumerState<GalleryHomeScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  String? _hoveredAlbumId;

  final List<String> _academicYears = [
    'All',
    'First Year',
    'Second Year',
    'Third Year',
    'Final Year',
  ];

  List<String> _getAvailableCategories(List<Album> albums) {
    final distinct = albums
        .map((a) => a.category)
        .where((c) => c.isNotEmpty)
        .toSet()
        .toList();
    distinct.sort();
    return ['All', ...distinct];
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(galleryProvider.notifier).loadAlbums();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(galleryProvider);
    final isWide = MediaQuery.of(context).size.width > 900;

    // Filter albums by search query as well
    final filteredAlbums = state.filteredAlbums.where((album) {
      if (_searchQuery.isEmpty) return true;
      final query = _searchQuery.toLowerCase();
      final titleMatch = album.title.toLowerCase().contains(query);
      final descMatch =
          album.description?.toLowerCase().contains(query) ?? false;
      final catMatch = album.category.toLowerCase().contains(query);
      return titleMatch || descMatch || catMatch;
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          // -- Editorial Hero Header --
          SliverToBoxAdapter(
            child: _buildEditorialHero(context, state, isWide),
          ),

          // -- Filter & Year Control Bar --
          SliverToBoxAdapter(
            child: _buildControlsBar(context, state, isWide),
          ),

          // -- Main Gallery Grid --
          if (state.isLoading)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      width: 36,
                      height: 36,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.mercury,
                      ),
                    ),
                    SizedBox(height: 16),
                    Text(
                      'LOADING ARCHIVES // BATCH 2027',
                      style: AppTextStyles.labelSmall,
                    ),
                  ],
                ),
              ),
            )
          else if (filteredAlbums.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _buildEmptyState(),
            )
          else
            SliverPadding(
              padding: EdgeInsets.symmetric(
                horizontal: isWide ? 40 : 20,
                vertical: 24,
              ),
              sliver: SliverGrid(
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: isWide ? 3 : 1,
                  crossAxisSpacing: 20,
                  mainAxisSpacing: 24,
                  childAspectRatio: isWide ? 1.15 : 1.25,
                ),
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    final album = filteredAlbums[index];
                    return _buildAlbumCard(album, index);
                  },
                  childCount: filteredAlbums.length,
                ),
              ),
            ),

          // -- Bottom Spacing & Archival Footer --
          SliverToBoxAdapter(
            child: _buildArchivalFooter(isWide),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.textPrimary,
        foregroundColor: const Color(0xFF000000),
        elevation: 8,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(0)),
        onPressed: () => context.go('/upload'),
        icon: const Icon(Icons.add_photo_alternate_outlined, size: 18),
        label: const Text(
          'NEW DROP',
          style: TextStyle(
            fontFamily: 'SpaceMono',
            fontWeight: FontWeight.w700,
            fontSize: 12,
            letterSpacing: 2,
          ),
        ),
      ),
    );
  }

  Widget _buildEditorialHero(
      BuildContext context, GalleryState state, bool isWide) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: isWide ? 48 : 28,
      ),
      decoration: const BoxDecoration(
        border: Border(
          bottom: BorderSide(color: AppColors.divider, width: 0.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top metadata line
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.divider, width: 0.5),
                  color: AppColors.surfaceElevated,
                ),
                child: Text(
                  'CONFIDENTIAL // CSE ARCHIVE',
                  style: AppTextStyles.labelSmall.copyWith(
                    color: AppColors.mercuryDark,
                    letterSpacing: 2,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Text('//', style: AppTextStyles.labelSmall),
              const SizedBox(width: 12),
              Text(
                '${state.albums.length} COLLECTIONS',
                style: AppTextStyles.labelSmall.copyWith(
                  color: AppColors.textSecondary,
                ),
              ),
              const Spacer(),
              Text(
                'LIVE INDEX [v1.0]',
                style: AppTextStyles.labelSmall.copyWith(
                  color: AppColors.mercuryDark,
                ),
              ),
            ],
          ).animate().fadeIn(duration: 400.ms),

          const SizedBox(height: 24),

          // Massive Editorial Headline
          Text(
            'THE AUTISTIC\nJOURNEY.',
            style: isWide
                ? AppTextStyles.displayLarge.copyWith(letterSpacing: -2)
                : AppTextStyles.headlineLarge.copyWith(
                    fontSize: 38,
                    letterSpacing: -1,
                  ),
          )
              .animate()
              .fadeIn(duration: 500.ms, delay: 100.ms)
              .slideY(begin: 0.1, end: 0, duration: 500.ms),

          const SizedBox(height: 16),

          // Subtitle / Manifesto description
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: Text(
              'A restricted digital vault documenting 4 years of college chaos, symposia, hostel midnight runs, and uncurated memories. Preserved for the Batch of 2023–2027.',
              style: AppTextStyles.bodyMedium.copyWith(
                color: AppColors.textSecondary,
                height: 1.6,
              ),
            ),
          ).animate().fadeIn(duration: 500.ms, delay: 200.ms),

          const SizedBox(height: 28),

          // Ticker Stats Row
          Row(
            children: [
              _buildStatChip(
                label: 'TOTAL CAPTURES',
                value: '${state.totalMediaCount}',
              ),
              const SizedBox(width: 24),
              _buildStatChip(
                label: 'ACADEMIC SPAN',
                value: '4 YEARS',
              ),
              const SizedBox(width: 24),
              _buildStatChip(
                label: 'ACCESS',
                value: 'INVITE ONLY',
              ),
            ],
          ).animate().fadeIn(duration: 500.ms, delay: 300.ms),
        ],
      ),
    );
  }

  Widget _buildStatChip({required String label, required String value}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppTextStyles.labelSmall.copyWith(
            fontSize: 8,
            letterSpacing: 2,
            color: AppColors.textDim,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            fontFamily: 'SpaceMono',
            fontWeight: FontWeight.w700,
            fontSize: 15,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }

  Widget _buildControlsBar(
      BuildContext context, GalleryState state, bool isWide) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: 16,
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
          // Year Selector Row (Nite Riot pill style)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            child: Row(
              children: _academicYears.map((year) {
                final isSelected = state.selectedYear == year;
                return Padding(
                  padding: const EdgeInsets.only(right: 12),
                  child: InkWell(
                    onTap: () =>
                        ref.read(galleryProvider.notifier).selectYear(year),
                    child: AnimatedContainer(
                      duration: AppDurations.fast,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? AppColors.textPrimary
                            : AppColors.surfaceElevated,
                        border: Border.all(
                          color: isSelected
                              ? AppColors.textPrimary
                              : AppColors.border,
                          width: 0.5,
                        ),
                      ),
                      child: Text(
                        year.toUpperCase(),
                        style: AppTextStyles.labelSmall.copyWith(
                          color: isSelected
                              ? const Color(0xFF000000)
                              : AppColors.textSecondary,
                          fontWeight: isSelected
                              ? FontWeight.w700
                              : FontWeight.w400,
                          letterSpacing: 1.5,
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),

          const SizedBox(height: 16),

          // Search & Category Filter Row
          Row(
            children: [
              // Search input
              Expanded(
                flex: 2,
                child: Container(
                  height: 38,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevated,
                    border: Border.all(color: AppColors.border, width: 0.5),
                  ),
                  child: TextField(
                    controller: _searchController,
                    onChanged: (val) => setState(() => _searchQuery = val),
                    style: AppTextStyles.bodySmall.copyWith(
                      color: AppColors.textPrimary,
                    ),
                    decoration: InputDecoration(
                      hintText: 'SEARCH MEMORIES...',
                      hintStyle: AppTextStyles.labelSmall.copyWith(
                        color: AppColors.textMuted,
                      ),
                      prefixIcon: const Icon(
                        Icons.search,
                        size: 16,
                        color: AppColors.textDim,
                      ),
                      suffixIcon: _searchQuery.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, size: 14),
                              onPressed: () {
                                _searchController.clear();
                                setState(() => _searchQuery = '');
                              },
                            )
                          : null,
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 10),
                    ),
                  ),
                ),
              ),

              const SizedBox(width: 12),

              // Category dropdown or horizontal scroll on wide
              if (isWide)
                Expanded(
                  flex: 3,
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: _getAvailableCategories(state.albums).map((cat) {
                        final isSel = (cat == 'All' &&
                                (state.selectedCategory == null ||
                                    state.selectedCategory!.isEmpty)) ||
                            state.selectedCategory == cat;
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: InkWell(
                            onTap: () {
                              ref
                                  .read(galleryProvider.notifier)
                                  .selectCategory(cat == 'All' ? null : cat);
                            },
                            child: AnimatedContainer(
                              duration: AppDurations.fast,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 8,
                              ),
                              decoration: BoxDecoration(
                                color: isSel
                                    ? AppColors.surfaceOverlay
                                    : Colors.transparent,
                                border: Border.all(
                                  color: isSel
                                      ? AppColors.mercuryDark
                                      : AppColors.border,
                                  width: 0.5,
                                ),
                              ),
                              child: Text(
                                cat.toUpperCase(),
                                style: AppTextStyles.labelSmall.copyWith(
                                  fontSize: 8,
                                  color: isSel
                                      ? AppColors.textPrimary
                                      : AppColors.textDim,
                                ),
                              ),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                )
              else
                DropdownButtonHideUnderline(
                  child: Container(
                    height: 38,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceElevated,
                      border: Border.all(color: AppColors.border, width: 0.5),
                    ),
                    child: DropdownButton<String>(
                      dropdownColor: AppColors.surfaceOverlay,
                      value: _getAvailableCategories(state.albums)
                              .contains(state.selectedCategory)
                          ? state.selectedCategory
                          : 'All',
                      icon: const Icon(
                        Icons.filter_list,
                        size: 14,
                        color: AppColors.mercuryDark,
                      ),
                      items: _getAvailableCategories(state.albums).map((cat) {
                        return DropdownMenuItem<String>(
                          value: cat,
                          child: Text(
                            cat.toUpperCase(),
                            style: AppTextStyles.labelSmall.copyWith(
                              fontSize: 9,
                              color: AppColors.textPrimary,
                            ),
                          ),
                        );
                      }).toList(),
                      onChanged: (val) {
                        ref
                            .read(galleryProvider.notifier)
                            .selectCategory(val == 'All' ? null : val);
                      },
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildAlbumCard(Album album, int index) {
    final isHovered = _hoveredAlbumId == album.id;

    return MouseRegion(
      onEnter: (_) => setState(() => _hoveredAlbumId = album.id),
      onExit: (_) => setState(() => _hoveredAlbumId = null),
      child: GestureDetector(
        onTap: () {
          context.go(
            '/album/${album.id}?title=${Uri.encodeComponent(album.title)}',
          );
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOutCubic,
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            border: Border.all(
              color: isHovered ? AppColors.mercury : AppColors.border,
              width: isHovered ? 1.0 : 0.5,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Cover Media Section
              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    // Image with zoom on hover
                    ClipRect(
                      child: AnimatedScale(
                        scale: isHovered ? 1.05 : 1.0,
                        duration: const Duration(milliseconds: 400),
                        curve: Curves.easeOutCubic,
                        child: CachedNetworkImage(
                          imageUrl: album.coverUrl ??
                              'https://picsum.photos/seed/${album.id}/800/600',
                          memCacheWidth: 600,
                          maxWidthDiskCache: 600,
                          filterQuality: FilterQuality.low,
                          fit: BoxFit.cover,
                          placeholder: (context, url) => Container(
                            color: AppColors.surfaceElevated,
                            child: const Center(
                              child: SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  color: AppColors.mercuryDark,
                                ),
                              ),
                            ),
                          ),
                          errorWidget: (context, url, error) => Container(
                            color: AppColors.surfaceElevated,
                            child: const Icon(
                              Icons.image_not_supported_outlined,
                              color: AppColors.mercuryDark,
                            ),
                          ),
                        ),
                      ),
                    ),

                    // Cinematic Gradient Vignette
                    Positioned.fill(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.transparent,
                              AppColors.background.withValues(alpha: 0.85),
                            ],
                            stops: const [0.4, 1.0],
                          ),
                        ),
                      ),
                    ),

                    // Top badge tags
                    Positioned(
                      top: 12,
                      left: 12,
                      right: 12,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.background.withValues(alpha: 0.8),
                              border: Border.all(
                                color: AppColors.border,
                                width: 0.5,
                              ),
                            ),
                            child: Text(
                              album.category.toUpperCase(),
                              style: AppTextStyles.labelSmall.copyWith(
                                fontSize: 8,
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.background.withValues(alpha: 0.8),
                              border: Border.all(
                                color: AppColors.border,
                                width: 0.5,
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(
                                  Icons.photo_library_outlined,
                                  size: 10,
                                  color: AppColors.mercuryDark,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  '${album.mediaCount}',
                                  style: AppTextStyles.labelSmall.copyWith(
                                    fontSize: 8,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Hover Quick Action Overlay
                    if (isHovered)
                      Positioned(
                        bottom: 12,
                        right: 12,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 5,
                          ),
                          decoration: const BoxDecoration(
                            color: AppColors.textPrimary,
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'VIEW VAULT',
                                style: AppTextStyles.labelSmall.copyWith(
                                  color: const Color(0xFF000000),
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(width: 4),
                              const Icon(
                                Icons.arrow_forward,
                                size: 10,
                                color: Color(0xFF000000),
                              ),
                            ],
                          ),
                        ).animate().fadeIn(duration: 150.ms),
                      ),
                  ],
                ),
              ),

              // Bottom Metadata Section
              Container(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          album.academicYear.toUpperCase(),
                          style: AppTextStyles.labelSmall.copyWith(
                            fontSize: 8,
                            color: AppColors.mercuryDark,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text('•', style: AppTextStyles.labelSmall),
                        const SizedBox(width: 8),
                        Text(
                          album.eventDate != null
                              ? '${album.eventDate!.day.toString().padLeft(2, '0')}/${album.eventDate!.month.toString().padLeft(2, '0')}/${album.eventDate!.year}'
                              : 'ARCHIVED',
                          style: AppTextStyles.labelSmall.copyWith(
                            fontSize: 8,
                            color: AppColors.textDim,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      album.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.headlineSmall.copyWith(
                        fontSize: 16,
                        color: isHovered
                            ? AppColors.textPrimary
                            : AppColors.mercury,
                      ),
                    ),
                    if (album.description != null &&
                        album.description!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        album.description!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.bodySmall.copyWith(
                          color: AppColors.textDim,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ).animate().fadeIn(
          duration: 350.ms,
          delay: (index * 50).ms,
        );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.folder_off_outlined,
            size: 40,
            color: AppColors.mercuryDark,
          ),
          const SizedBox(height: 16),
          Text(
            'NO ARCHIVES LOCATED',
            style: AppTextStyles.labelMedium.copyWith(
              color: AppColors.textSecondary,
              letterSpacing: 2,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'No matching albums found for the selected query or filters.',
            style: AppTextStyles.bodySmall.copyWith(color: AppColors.textDim),
          ),
          const SizedBox(height: 24),
          OutlinedButton(
            onPressed: () {
              _searchController.clear();
              setState(() => _searchQuery = '');
              ref.read(galleryProvider.notifier).selectYear('All');
              ref.read(galleryProvider.notifier).selectCategory(null);
            },
            child: const Text('RESET FILTERS'),
          ),
        ],
      ),
    );
  }

  Widget _buildArchivalFooter(bool isWide) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: 32,
      ),
      decoration: const BoxDecoration(
        border: Border(
          top: BorderSide(color: AppColors.divider, width: 0.5),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            '© 2023-2027 THE AUTISTIC JOURNEY. ALL RIGHTS RESERVED.',
            style: AppTextStyles.labelSmall.copyWith(fontSize: 8),
          ),
          Text(
            'END-TO-END VERIFIED ARCHIVE',
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 8,
              color: AppColors.mercuryDark,
            ),
          ),
        ],
      ),
    );
  }
}
