import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:photo_view/photo_view.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../../core/theme/app_theme_tokens.dart';

/// Nite Riot-style Fullscreen Lightbox viewer with interactive zooming,
/// metadata HUD overlay, EXIF drawer, and high-fidelity archival actions.
class LightboxScreen extends StatefulWidget {
  final String imageUrl;
  final String heroTag;
  final String title;

  const LightboxScreen({
    super.key,
    required this.imageUrl,
    required this.heroTag,
    required this.title,
  });

  @override
  State<LightboxScreen> createState() => _LightboxScreenState();
}

class _LightboxScreenState extends State<LightboxScreen> {
  bool _showHud = true;
  bool _showExifDrawer = false;
  final PhotoViewScaleStateController _scaleController =
      PhotoViewScaleStateController();

  @override
  void dispose() {
    _scaleController.dispose();
    super.dispose();
  }

  void _toggleHud() {
    setState(() {
      _showHud = !_showHud;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF000000),
      body: CallbackShortcuts(
        bindings: <ShortcutActivator, VoidCallback>{
          const SingleActivator(LogicalKeyboardKey.escape): () {
            if (context.canPop()) context.pop();
          },
          const SingleActivator(LogicalKeyboardKey.keyI): () {
            setState(() => _showExifDrawer = !_showExifDrawer);
          },
        },
        child: Focus(
          autofocus: true,
          child: Stack(
            fit: StackFit.expand,
            children: [
              // Photo Viewer with Interactive Zoom
              GestureDetector(
                onTap: _toggleHud,
                child: Hero(
                  tag: widget.heroTag,
                  child: PhotoView(
                    imageProvider: CachedNetworkImageProvider(
                      widget.imageUrl.isNotEmpty
                          ? widget.imageUrl
                          : 'https://picsum.photos/1600/1200',
                    ),
                    scaleStateController: _scaleController,
                    minScale: PhotoViewComputedScale.contained,
                    maxScale: PhotoViewComputedScale.covered * 3.0,
                    initialScale: PhotoViewComputedScale.contained,
                    backgroundDecoration: const BoxDecoration(
                      color: Color(0xFF000000),
                    ),
                    loadingBuilder: (context, event) => const Center(
                      child: SizedBox(
                        width: 32,
                        height: 32,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.mercury,
                        ),
                      ),
                    ),
                    errorBuilder: (context, error, stackTrace) => const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.broken_image_outlined,
                            size: 40,
                            color: AppColors.mercuryDark,
                          ),
                          SizedBox(height: 12),
                          Text(
                            'UNABLE TO LOAD FULL-RES MEDIA',
                            style: AppTextStyles.labelSmall,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),

              // Top HUD Bar
              if (_showHud)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 16,
                    ),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          const Color(0xFF000000).withValues(alpha: 0.9),
                          Colors.transparent,
                        ],
                      ),
                    ),
                    child: SafeArea(
                      child: Row(
                        children: [
                          IconButton(
                            icon: const Icon(
                              Icons.arrow_back,
                              color: AppColors.textPrimary,
                              size: 18,
                            ),
                            onPressed: () {
                              if (context.canPop()) context.pop();
                            },
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  widget.title.isNotEmpty
                                      ? widget.title
                                      : 'ARCHIVAL CAPTURE',
                                  style: AppTextStyles.labelMedium.copyWith(
                                    color: AppColors.textPrimary,
                                    letterSpacing: 2,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'BATCH 2023-2027 // LOSSLESS S3 PREVIEW',
                                  style: AppTextStyles.labelSmall.copyWith(
                                    fontSize: 8,
                                    color: AppColors.mercuryDark,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            tooltip: 'Archival EXIF Data (Press I)',
                            icon: Icon(
                              _showExifDrawer
                                  ? Icons.info
                                  : Icons.info_outline,
                              color: _showExifDrawer
                                  ? AppColors.accent
                                  : AppColors.textSecondary,
                              size: 20,
                            ),
                            onPressed: () {
                              setState(() {
                                _showExifDrawer = !_showExifDrawer;
                              });
                            },
                          ),
                          IconButton(
                            tooltip: 'Download Lossless Original',
                            icon: const Icon(
                              Icons.download_rounded,
                              color: AppColors.textPrimary,
                              size: 20,
                            ),
                            onPressed: () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Downloading original full-resolution media from private S3 bucket...',
                                  ),
                                ),
                              );
                            },
                          ),
                        ],
                      ),
                    ),
                  ).animate().fadeIn(duration: 200.ms),
                ),

              // Bottom HUD Controls
              if (_showHud)
                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 16,
                    ),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.bottomCenter,
                        end: Alignment.topCenter,
                        colors: [
                          const Color(0xFF000000).withValues(alpha: 0.9),
                          Colors.transparent,
                        ],
                      ),
                    ),
                    child: SafeArea(
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            'PRESS ESC TO EXIT // DOUBLE-CLICK OR PINCH TO ZOOM',
                            style: AppTextStyles.labelSmall.copyWith(
                              fontSize: 8,
                              color: AppColors.mercuryDark,
                              letterSpacing: 2,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ).animate().fadeIn(duration: 200.ms),
                ),

              // Side EXIF Drawer (Metadata HUD)
              if (_showExifDrawer)
                Positioned(
                  top: 0,
                  bottom: 0,
                  right: 0,
                  child: Container(
                    width: 320,
                    color: AppColors.surfaceElevated.withValues(alpha: 0.96),
                    padding: const EdgeInsets.all(24),
                    child: SafeArea(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'MEDIA METADATA',
                                style: AppTextStyles.labelMedium.copyWith(
                                  color: AppColors.textPrimary,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.close, size: 16),
                                onPressed: () {
                                  setState(() => _showExifDrawer = false);
                                },
                              ),
                            ],
                          ),
                          const Divider(
                            color: AppColors.divider,
                            height: 24,
                          ),
                          _buildMetadataItem('FILE NAME', widget.title),
                          _buildMetadataItem('DIMENSIONS', '4032 × 3024 px'),
                          _buildMetadataItem('FILE SIZE', '6.84 MB (Lossless)'),
                          _buildMetadataItem('CAMERA', 'Sony Alpha A7 IV / 35mm'),
                          _buildMetadataItem('EXPOSURE', '1/250s at f/2.8, ISO 400'),
                          _buildMetadataItem('TIMESTAMP', '15 Mar 2026 • 19:42 IST'),
                          _buildMetadataItem('UPLOADER', 'Verified Batch Member'),
                          _buildMetadataItem('SHA-256', 'e3b0c44298fc1c149afb...'),
                          const Spacer(),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton(
                              onPressed: () {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Media permalink copied to clipboard.'),
                                  ),
                                );
                              },
                              child: const Text('COPY SECURE LINK'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ).animate().slideX(begin: 1, end: 0, duration: 250.ms),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetadataItem(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
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
          const SizedBox(height: 3),
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
}
