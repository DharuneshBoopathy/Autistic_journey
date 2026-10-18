/// Album model matching the PostgreSQL `albums` table (Section 6).
class Album {
  final String id;
  final String title;
  final String? description;
  final String academicYear;
  final String category;
  final DateTime? eventDate;
  final String? coverMediaId;
  final String? coverUrl;
  final String visibilityScope;
  final String? createdBy;
  final bool isArchived;
  final DateTime createdAt;
  final int mediaCount;

  const Album({
    required this.id,
    required this.title,
    this.description,
    required this.academicYear,
    required this.category,
    this.eventDate,
    this.coverMediaId,
    this.coverUrl,
    this.visibilityScope = 'BATCH_WIDE',
    this.createdBy,
    this.isArchived = false,
    required this.createdAt,
    this.mediaCount = 0,
  });

  factory Album.fromJson(Map<String, dynamic> json) => Album(
        id: json['id'] as String,
        title: json['title'] as String,
        description: json['description'] as String?,
        academicYear: json['academic_year'] as String,
        category: json['category'] as String,
        eventDate: json['event_date'] != null
            ? DateTime.parse(json['event_date'] as String)
            : null,
        coverMediaId: json['cover_media_id'] as String?,
        coverUrl: json['cover_url'] as String?,
        visibilityScope: json['visibility_scope'] as String? ?? 'BATCH_WIDE',
        createdBy: json['created_by'] as String?,
        isArchived: json['is_archived'] as bool? ?? false,
        createdAt: DateTime.parse(json['created_at'] as String),
        mediaCount: json['media_count'] as int? ?? 0,
      );

}


/// Media item model matching the PostgreSQL `media` table (Section 6).
class MediaItem {
  final String id;
  final String albumId;
  final String? uploaderId;
  final String? uploaderName;
  final String originalS3Key;
  final String? previewS3Key;
  final String? thumbS3Key;
  final String? thumbUrl;
  final String? previewUrl;
  final String? originalUrl;
  final String fileName;
  final String mimeType;
  final int fileSizeBytes;
  final String sha256Hash;
  final int? width;
  final int? height;
  final int? durationSeconds;
  final DateTime? takenAt;
  final DateTime uploadedAt;
  final bool isDeleted;

  const MediaItem({
    required this.id,
    required this.albumId,
    this.uploaderId,
    this.uploaderName,
    required this.originalS3Key,
    this.previewS3Key,
    this.thumbS3Key,
    this.thumbUrl,
    this.previewUrl,
    this.originalUrl,
    required this.fileName,
    required this.mimeType,
    required this.fileSizeBytes,
    required this.sha256Hash,
    this.width,
    this.height,
    this.durationSeconds,
    this.takenAt,
    required this.uploadedAt,
    this.isDeleted = false,
  });

  bool get isVideo => mimeType.startsWith('video/');
  bool get isImage => mimeType.startsWith('image/');

  String get fileSizeFormatted {
    if (fileSizeBytes < 1024) return '${fileSizeBytes}B';
    if (fileSizeBytes < 1024 * 1024) {
      return '${(fileSizeBytes / 1024).toStringAsFixed(1)}KB';
    }
    if (fileSizeBytes < 1024 * 1024 * 1024) {
      return '${(fileSizeBytes / (1024 * 1024)).toStringAsFixed(1)}MB';
    }
    return '${(fileSizeBytes / (1024 * 1024 * 1024)).toStringAsFixed(1)}GB';
  }

  factory MediaItem.fromJson(Map<String, dynamic> json) => MediaItem(
        id: json['id'] as String,
        albumId: json['album_id'] as String,
        uploaderId: json['uploader_id'] as String?,
        uploaderName: json['uploader_name'] as String?,
        originalS3Key: json['original_s3_key'] as String,
        previewS3Key: json['preview_s3_key'] as String?,
        thumbS3Key: json['thumb_s3_key'] as String?,
        thumbUrl: json['thumb_url'] as String?,
        previewUrl: json['preview_url'] as String?,
        originalUrl: json['original_url'] as String?,
        fileName: json['file_name'] as String,
        mimeType: json['mime_type'] as String,
        fileSizeBytes: json['file_size_bytes'] as int,
        sha256Hash: json['sha256_hash'] as String,
        width: json['width'] as int?,
        height: json['height'] as int?,
        durationSeconds: json['duration_seconds'] as int?,
        takenAt: json['taken_at'] != null
            ? DateTime.parse(json['taken_at'] as String)
            : null,
        uploadedAt: DateTime.parse(json['uploaded_at'] as String),
        isDeleted: json['is_deleted'] as bool? ?? false,
      );
}

