import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import '../../../../core/theme/app_theme_tokens.dart';
import '../../../../models/album_model.dart';
import 'package:the_autistic_journey/features/gallery/providers/gallery_provider.dart';

/// Album Detail Screen showcasing individual media entries.
/// Features staggered masonry grid, hover zooms, multi-select batch actions,
/// and smooth hero transitions into the fullscreen lightbox viewer.
class AlbumDetailScreen extends ConsumerStatefulWidget {
  final String albumId;
  final String albumTitle;

  const AlbumDetailScreen({
    super.key,
    required this.albumId,
    required this.albumTitle,
  });

  @override
  ConsumerState<AlbumDetailScreen> createState() => _AlbumDetailScreenState();
}

class _AlbumDetailScreenState extends ConsumerState<AlbumDetailScreen> {
  final Set<String> _selectedMediaIds = {};
  bool _isSelectionMode = false;
  String? _hoveredMediaId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(albumMediaProvider.notifier).loadMedia(widget.albumId);
    });
  }

  void _toggleSelect(String mediaId) {
    setState(() {
      if (_selectedMediaIds.contains(mediaId)) {
        _selectedMediaIds.remove(mediaId);
        if (_selectedMediaIds.isEmpty) _isSelectionMode = false;
      } else {
        _selectedMediaIds.add(mediaId);
        _isSelectionMode = true;
      }
    });
  }

  void _selectAll(List<MediaItem> items) {
    setState(() {
      if (_selectedMediaIds.length == items.length) {
        _selectedMediaIds.clear();
        _isSelectionMode = false;
      } else {
        _selectedMediaIds.addAll(items.map((e) => e.id));
        _isSelectionMode = true;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final mediaState = ref.watch(albumMediaProvider);
    final isWide = MediaQuery.of(context).size.width > 900;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          // -- Top Context Bar & Back Navigation --
          SliverToBoxAdapter(
            child: _buildHeader(context, mediaState, isWide),
          ),

          // -- Multi-select Action Bar (if active) --
          if (_isSelectionMode)
            SliverToBoxAdapter(
              child: _buildBatchActionBar(mediaState.items),
            ),

          // -- Staggered Media Grid --
          if (mediaState.isLoading)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      width: 32,
                      height: 32,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.mercury,
                      ),
                    ),
                    SizedBox(height: 16),
                    Text(
                      'INDEXING VAULT MEDIA...',
                      style: AppTextStyles.labelSmall,
                    ),
                  ],
                ),
              ),
            )
          else if (mediaState.items.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.photo_library_outlined,
                      size: 48,
                      color: AppColors.mercuryDark,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'EMPTY VAULT',
                      style: AppTextStyles.labelMedium.copyWith(
                        letterSpacing: 2,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'No media has been uploaded to this album yet.',
                      style: AppTextStyles.bodySmall.copyWith(
                        color: AppColors.textDim,
                      ),
                    ),
                    const SizedBox(height: 24),
                    ElevatedButton(
                      onPressed: () => context.go('/upload'),
                      child: const Text('UPLOAD FIRST DROP'),
                    ),
                  ],
                ),
              ),
            )
          else
            SliverPadding(
              padding: EdgeInsets.symmetric(
                horizontal: isWide ? 40 : 16,
                vertical: 24,
              ),
              sliver: SliverMasonryGrid.count(
                crossAxisCount: isWide ? 4 : 2,
                mainAxisSpacing: 14,
                crossAxisSpacing: 14,
                itemBuilder: (context, index) {
                  final item = mediaState.items[index];
                  return _buildMediaTile(item, index);
                },
                childCount: mediaState.items.length,
              ),
            ),

          const SliverToBoxAdapter(
            child: SizedBox(height: 80),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader(
      BuildContext context, AlbumMediaState mediaState, bool isWide) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isWide ? 40 : 20,
        vertical: 24,
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
          // Breadcrumb & Back row
          Row(
            children: [
              InkWell(
                onTap: () => context.go('/gallery'),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.arrow_back,
                      size: 14,
                      color: AppColors.textPrimary,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'BACK TO GALLERY',
                      style: AppTextStyles.labelSmall.copyWith(
                        color: AppColors.textPrimary,
                        letterSpacing: 2,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Text('//', style: AppTextStyles.labelSmall),
              const SizedBox(width: 16),
              Text(
                'ALBUM ID: ${widget.albumId.toUpperCase()}',
                style: AppTextStyles.labelSmall.copyWith(
                  color: AppColors.mercuryDark,
                ),
              ),
              const Spacer(),
              if (!_isSelectionMode)
                OutlinedButton.icon(
                  onPressed: () => setState(() => _isSelectionMode = true),
                  icon: const Icon(Icons.checklist_rounded, size: 14),
                  label: const Text('SELECT'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    textStyle: AppTextStyles.labelSmall,
                  ),
                ),
            ],
          ),

          const SizedBox(height: 20),

          // Title & Stats
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.albumTitle,
                      style: isWide
                          ? AppTextStyles.headlineLarge.copyWith(fontSize: 28)
                          : AppTextStyles.headlineMedium.copyWith(fontSize: 22),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${mediaState.items.length} ARCHIVAL ITEMS // CAPTURED DURING BATCH 2027 TIMELINE',
                      style: AppTextStyles.labelSmall.copyWith(
                        color: AppColors.textSecondary,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
              if (isWide) ...[
                OutlinedButton.icon(
                  onPressed: () => context.go('/upload'),
                  icon: const Icon(Icons.cloud_upload_outlined, size: 14),
                  label: const Text('CONTRIBUTE DROP'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 14,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBatchActionBar(List<MediaItem> items) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 12),
      color: AppColors.surfaceElevated,
      child: Row(
        children: [
          Checkbox(
            value: _selectedMediaIds.length == items.length && items.isNotEmpty,
            activeColor: AppColors.accent,
            checkColor: const Color(0xFF000000),
            onChanged: (_) => _selectAll(items),
          ),
          Text(
            '${_selectedMediaIds.length} SELECTED',
            style: AppTextStyles.labelSmall.copyWith(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          const Spacer(),
          TextButton.icon(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    'Preparing batch ZIP download for ${_selectedMediaIds.length} items...',
                  ),
                ),
              );
            },
            icon: const Icon(Icons.download_rounded, size: 16),
            label: const Text('BATCH ZIP DOWNLOAD'),
          ),
          const SizedBox(width: 16),
          IconButton(
            tooltip: 'Cancel Selection',
            icon: const Icon(Icons.close, size: 16),
            onPressed: () {
              setState(() {
                _selectedMediaIds.clear();
                _isSelectionMode = false;
              });
            },
          ),
        ],
      ),
    );
  }

  Widget _buildMediaTile(MediaItem item, int index) {
    final isSelected = _selectedMediaIds.contains(item.id);
    final isHovered = _hoveredMediaId == item.id;
    final heroTag = 'hero-media-${item.id}';

    // Alternate aspect ratios slightly for staggered masonry visual interest
    final double aspectRatio = (index % 5 == 0)
        ? 0.75
        : (index % 3 == 0)
            ? 1.33
            : 1.0;

    return MouseRegion(
      onEnter: (_) => setState(() => _hoveredMediaId = item.id),
      onExit: (_) => setState(() => _hoveredMediaId = null),
      child: GestureDetector(
        onTap: () {
          if (_isSelectionMode) {
            _toggleSelect(item.id);
          } else {
            // Open Lightbox with Hero animation
            context.push(
              '/lightbox',
              extra: {
                'imageUrl': item.previewUrl ?? item.thumbUrl ?? '',
                'heroTag': heroTag,
                'title': item.fileName,
              },
            );
          }
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            border: Border.all(
              color: isSelected
                  ? AppColors.accent
                  : (isHovered ? AppColors.mercury : AppColors.border),
              width: isSelected ? 2.0 : (isHovered ? 1.0 : 0.5),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AspectRatio(
                aspectRatio: aspectRatio,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Hero(
                      tag: heroTag,
                      child: item.isVideo
                          ? Container(
                              color: AppColors.surfaceElevated,
                              child: Center(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(12),
                                      decoration: BoxDecoration(
                                        color: AppColors.background.withValues(alpha: 0.8),
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: AppColors.mercuryDark,
                                          width: 0.5,
                                        ),
                                      ),
                                      child: const Icon(
                                        Icons.play_arrow_rounded,
                                        size: 28,
                                        color: AppColors.textPrimary,
                                      ),
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      'MP4 ARCHIVE',
                                      style: AppTextStyles.labelSmall.copyWith(
                                        fontSize: 8,
                                        letterSpacing: 1.5,
                                        color: AppColors.mercuryDark,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            )
                          : CachedNetworkImage(
                              imageUrl: item.thumbUrl ??
                                  'https://picsum.photos/seed/${item.id}/400/400',
                              memCacheWidth: 400,
                              maxWidthDiskCache: 400,
                              filterQuality: FilterQuality.low,
                              fit: BoxFit.cover,
                              placeholder: (context, url) => Container(
                                color: AppColors.surfaceElevated,
                                child: const Center(
                                  child: SizedBox(
                                    width: 16,
                                    height: 16,
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
                                  Icons.broken_image_outlined,
                                  size: 20,
                                  color: AppColors.mercuryDark,
                                ),
                              ),
                            ),
                    ),

                    // Hover darkened gradient
                    if (isHovered || isSelected)
                      Positioned.fill(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Colors.transparent,
                                AppColors.background.withValues(alpha: 0.8),
                              ],
                            ),
                          ),
                        ),
                      ),

                    // Selection checkbox
                    if (_isSelectionMode || isHovered)
                      Positioned(
                        top: 8,
                        left: 8,
                        child: GestureDetector(
                          onTap: () => _toggleSelect(item.id),
                          child: Container(
                            width: 22,
                            height: 22,
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? AppColors.accent
                                  : AppColors.background.withValues(alpha: 0.6),
                              border: Border.all(
                                color: isSelected
                                    ? AppColors.accent
                                    : AppColors.mercury,
                                width: 1,
                              ),
                            ),
                            child: isSelected
                                ? const Icon(
                                    Icons.check,
                                    size: 14,
                                    color: Color(0xFF000000),
                                  )
                                : null,
                          ),
                        ),
                      ),

                    // Bottom info on hover
                    if (isHovered)
                      Positioned(
                        bottom: 8,
                        left: 8,
                        right: 8,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              item.fileName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppTextStyles.labelSmall.copyWith(
                                color: AppColors.textPrimary,
                                fontSize: 9,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              item.fileSizeFormatted,
                              style: AppTextStyles.labelSmall.copyWith(
                                color: AppColors.textDim,
                                fontSize: 8,
                              ),
                            ),
                          ],
                        ),
                      ).animate().fadeIn(duration: 150.ms),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ).animate().fadeIn(
      duration: 200.ms,
      delay: index < 12 ? (index * 20).ms : Duration.zero,
    );
  }
}
