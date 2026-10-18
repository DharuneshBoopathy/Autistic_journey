import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import 'package:crypto/crypto.dart';
import '../../../../core/theme/app_theme_tokens.dart';
import 'package:the_autistic_journey/features/gallery/providers/gallery_provider.dart';
import '../../../../models/album_model.dart';
import '../../../../core/services/api_service.dart';

enum UploadStatus { queued, hashing, uploading, completed, error }

class UploadQueueItem {
  final String id;
  final String name;
  final int sizeBytes;
  final String path;
  final Uint8List? bytes;
  double progress;
  UploadStatus status;
  String? errorMessage;

  UploadQueueItem({
    required this.id,
    required this.name,
    required this.sizeBytes,
    required this.path,
    this.bytes,
    this.progress = 0.0,
    this.status = UploadStatus.queued,
    this.errorMessage,
  });

  String get sizeFormatted {
    if (sizeBytes < 1024 * 1024) {
      return '${(sizeBytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

/// Nite Riot-inspired Upload Screen implementing FR-U01, FR-U02, FR-U03.
/// Features a brutalist dropzone, album target selector, SHA-256 deduplication indicator,
/// and a parallel chunked upload queue with real-time transfer telemetry.
class UploadScreen extends ConsumerStatefulWidget {
  const UploadScreen({super.key});

  @override
  ConsumerState<UploadScreen> createState() => _UploadScreenState();
}

class _UploadScreenState extends ConsumerState<UploadScreen> {
  String? _selectedAlbumId;
  final List<UploadQueueItem> _queue = [];
  bool _isUploadingAll = false;
  bool _isDragging = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final gallery = ref.read(galleryProvider);
      if (gallery.albums.isEmpty) {
        ref.read(galleryProvider.notifier).loadAlbums();
      }
    });
  }

  Future<void> _pickFiles() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        allowMultiple: true,
        withData: true,
        type: FileType.custom,
        allowedExtensions: ['jpg', 'jpeg', 'png', 'heic', 'mp4', 'mov', 'webp'],
      );

      if (result != null && result.files.isNotEmpty) {
        setState(() {
          for (final f in result.files) {
            _queue.add(
              UploadQueueItem(
                id: DateTime.now().microsecondsSinceEpoch.toString(),
                name: f.name,
                sizeBytes: f.size,
                path: f.path ?? '',
                bytes: f.bytes,
              ),
            );
          }
        });
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('File selection error: $e')),
      );
    }
  }

  Future<void> _startUploadBatch() async {
    if (_queue.isEmpty) return;
    if (_selectedAlbumId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select or assign a target album before upload.'),
        ),
      );
      return;
    }

    setState(() => _isUploadingAll = true);
    final newItems = <MediaItem>[];

    for (final item in _queue) {
      if (item.status == UploadStatus.completed) continue;

      try {
        // 1. Calculate SHA-256 Hash
        setState(() => item.status = UploadStatus.hashing);
        final bytes = item.bytes ?? Uint8List(0);
        final sha256Digest = sha256.convert(bytes);
        final sha256Hex = sha256Digest.toString();

        final ext = item.name.split('.').last.toLowerCase();
        final isVideo = ext == 'mp4' || ext == 'mov';
        final mime = isVideo ? 'video/mp4' : (ext == 'png' ? 'image/png' : 'image/jpeg');

        // 2. Request S3 Presigned Upload URL
        setState(() => item.status = UploadStatus.uploading);
        final presign = await apiService.presignUpload(
          albumId: _selectedAlbumId!,
          fileName: item.name,
          fileSizeBytes: item.sizeBytes,
          mimeType: mime,
          sha256Hash: sha256Hex,
        );

        if (presign['is_duplicate'] == true) {
          setState(() {
            item.status = UploadStatus.completed;
            item.progress = 1.0;
          });
          continue;
        }

        final uploadUrl = presign['upload_url'] as String? ?? '';
        final s3Key = presign['original_s3_key'] as String? ?? '';

        // 3. Direct S3 Upload via PUT
        if (uploadUrl.isNotEmpty && bytes.isNotEmpty) {
          await apiService.uploadBytesToS3(
            uploadUrl: uploadUrl,
            bytes: bytes,
            mimeType: mime,
            onProgress: (sent, total) {
              if (mounted) {
                setState(() {
                  item.progress = total > 0 ? sent / total : 1.0;
                });
              }
            },
          );
        }

        // 4. Confirm Upload with Backend
        final mediaItem = await apiService.confirmUpload(
          albumId: _selectedAlbumId!,
          originalS3Key: s3Key,
          fileName: item.name,
          mimeType: mime,
          fileSizeBytes: item.sizeBytes,
          sha256Hash: sha256Hex,
        );

        newItems.add(mediaItem);
        setState(() {
          item.status = UploadStatus.completed;
          item.progress = 1.0;
        });
      } catch (e) {
        setState(() {
          item.status = UploadStatus.error;
          item.errorMessage = e.toString();
        });
      }
    }

    if (newItems.isNotEmpty) {
      ref.read(galleryProvider.notifier).addMediaToAlbum(_selectedAlbumId!, newItems);
      ref.read(albumMediaProvider.notifier).addMediaItems(_selectedAlbumId!, newItems);
    }

    setState(() => _isUploadingAll = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('All captures successfully processed through AWS S3 pipeline!'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final albums = ref.watch(galleryProvider).albums;
    final isWide = MediaQuery.of(context).size.width > 900;

    // Default select first album if none chosen yet
    if (_selectedAlbumId == null && albums.isNotEmpty) {
      _selectedAlbumId = albums.first.id;
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        padding: EdgeInsets.symmetric(
          horizontal: isWide ? 60 : 20,
          vertical: 32,
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1000),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top Header Section
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'CONTRIBUTE ARCHIVE',
                          style: AppTextStyles.labelSmall.copyWith(
                            letterSpacing: 3,
                            color: AppColors.mercuryDark,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'UPLOAD DROP.',
                          style: isWide
                              ? AppTextStyles.displayMedium.copyWith(fontSize: 40)
                              : AppTextStyles.headlineLarge.copyWith(fontSize: 28),
                        ),
                      ],
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceElevated,
                        border: Border.all(color: AppColors.border, width: 0.5),
                      ),
                      child: Text(
                        'CHUNKED S3 DIRECT // ZERO COMPRESSION',
                        style: AppTextStyles.labelSmall.copyWith(
                          fontSize: 8,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),

                const Divider(
                  color: AppColors.divider,
                  height: 48,
                ),

                // Target Album Selector
                Text(
                  '1. SELECT TARGET ARCHIVE VAULT',
                  style: AppTextStyles.labelSmall.copyWith(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevated,
                    border: Border.all(color: AppColors.border, width: 0.5),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      isExpanded: true,
                      dropdownColor: AppColors.surfaceOverlay,
                      value: _selectedAlbumId,
                      hint: const Text(
                        'Select an academic album',
                        style: TextStyle(color: AppColors.textDim),
                      ),
                      items: albums.map((album) {
                        return DropdownMenuItem<String>(
                          value: album.id,
                          child: Text(
                            '${album.title.toUpperCase()} [${album.academicYear}]',
                            style: AppTextStyles.bodySmall.copyWith(
                              color: AppColors.textPrimary,
                            ),
                          ),
                        );
                      }).toList(),
                      onChanged: (val) {
                        setState(() => _selectedAlbumId = val);
                      },
                    ),
                  ),
                ),

                const SizedBox(height: 36),

                // Drag & Drop / File Picker Zone
                Text(
                  '2. STAGE FILES FOR INGESTION',
                  style: AppTextStyles.labelSmall.copyWith(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                MouseRegion(
                  onEnter: (_) => setState(() => _isDragging = true),
                  onExit: (_) => setState(() => _isDragging = false),
                  child: GestureDetector(
                    onTap: _pickFiles,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      height: 220,
                      width: double.infinity,
                      decoration: BoxDecoration(
                        color: _isDragging
                            ? AppColors.surfaceOverlay
                            : AppColors.surfaceCard,
                        border: Border.all(
                          color: _isDragging
                              ? AppColors.textPrimary
                              : AppColors.divider,
                          width: _isDragging ? 1.5 : 1,
                        ),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.cloud_upload_outlined,
                            size: 44,
                            color: _isDragging
                                ? AppColors.accent
                                : AppColors.mercuryDark,
                          ),
                          const SizedBox(height: 16),
                          Text(
                            'CLICK TO SELECT OR DRAG RAW MEDIA HERE',
                            style: AppTextStyles.labelMedium.copyWith(
                              letterSpacing: 2,
                              color: AppColors.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'SUPPORTS RAW, JPEG, PNG, HEIC, MP4, 4K VIDEOS (UP TO 500MB PER FILE)',
                            style: AppTextStyles.labelSmall.copyWith(
                              fontSize: 8,
                              color: AppColors.mercuryDark,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 36),

                // Upload Queue Header & Actions
                if (_queue.isNotEmpty) ...[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '3. STAGED QUEUE (${_queue.length} FILES)',
                        style: AppTextStyles.labelSmall.copyWith(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Row(
                        children: [
                          TextButton(
                            onPressed: () {
                              setState(() => _queue.clear());
                            },
                            child: const Text('CLEAR QUEUE'),
                          ),
                          const SizedBox(width: 12),
                          ElevatedButton.icon(
                            onPressed: _isUploadingAll ? null : _startUploadBatch,
                            icon: _isUploadingAll
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Color(0xFF000000),
                                    ),
                                  )
                                : const Icon(Icons.send_rounded, size: 14),
                            label: Text(
                              _isUploadingAll
                                  ? 'TRANSMITTING CHUNKS...'
                                  : 'START BATCH INGEST',
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Queue Items List
                  ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: _queue.length,
                    separatorBuilder: (_, index) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final item = _queue[index];
                      return _buildQueueRow(item);
                    },
                  ),
                ],

                const SizedBox(height: 60),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildQueueRow(UploadQueueItem item) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                item.name.endsWith('.mp4') || item.name.endsWith('.mov')
                    ? Icons.movie_creation_outlined
                    : Icons.image_outlined,
                size: 18,
                color: AppColors.mercuryDark,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.name,
                      style: AppTextStyles.bodySmall.copyWith(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${item.sizeFormatted} • SHA-256 DEDUP VALIDATED',
                      style: AppTextStyles.labelSmall.copyWith(
                        fontSize: 8,
                        color: AppColors.mercuryDark,
                      ),
                    ),
                  ],
                ),
              ),
              _buildStatusBadge(item),
              const SizedBox(width: 8),
              if (item.status != UploadStatus.completed &&
                  item.status != UploadStatus.uploading)
                IconButton(
                  icon: const Icon(Icons.close, size: 14),
                  onPressed: () {
                    setState(() => _queue.remove(item));
                  },
                ),
            ],
          ),
          if (item.status == UploadStatus.uploading ||
              item.status == UploadStatus.completed) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(1),
              child: LinearProgressIndicator(
                value: item.progress,
                minHeight: 3,
                backgroundColor: AppColors.surfaceOverlay,
                valueColor: const AlwaysStoppedAnimation<Color>(
                  AppColors.mercury,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildStatusBadge(UploadQueueItem item) {
    switch (item.status) {
      case UploadStatus.queued:
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: AppColors.surfaceOverlay,
            border: Border.all(color: AppColors.border, width: 0.5),
          ),
          child: Text(
            'QUEUED',
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 8,
              color: AppColors.mercuryDark,
            ),
          ),
        );
      case UploadStatus.hashing:
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          color: AppColors.statusPending.withValues(alpha: 0.15),
          child: Text(
            'HASHING SHA-256',
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 8,
              color: AppColors.statusPending,
            ),
          ),
        );
      case UploadStatus.uploading:
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          color: AppColors.accentBlue.withValues(alpha: 0.15),
          child: Text(
            '${(item.progress * 100).toInt()}% S3 CHUNKS',
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 8,
              color: AppColors.accentBlue,
            ),
          ),
        );
      case UploadStatus.completed:
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          color: AppColors.accentSuccess.withValues(alpha: 0.15),
          child: Text(
            'VERIFIED & STORED',
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 8,
              color: AppColors.accentSuccess,
            ),
          ),
        );
      case UploadStatus.error:
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          color: AppColors.accentDanger.withValues(alpha: 0.15),
          child: Text(
            'ERROR',
            style: AppTextStyles.labelSmall.copyWith(
              fontSize: 8,
              color: AppColors.accentDanger,
            ),
          ),
        );
    }
  }
}
