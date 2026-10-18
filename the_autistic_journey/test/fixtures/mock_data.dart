import 'package:the_autistic_journey/models/album_model.dart';
import 'package:the_autistic_journey/models/user_model.dart';

/// Test and development mock fixtures separated from production application code.
class MockTestFixtures {
  static final User mockAdminUser = User(
    id: 'usr-admin-01',
    email: 'admin@theautisticjourney.com',
    fullName: 'Batch Administrator',
    rollNumber: 'ADMIN001',
    batchYear: '2023-2027',
    gender: 'Other',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    createdAt: DateTime(2023, 8, 1),
    updatedAt: DateTime.now(),
  );

  static final User mockStudentUser = User(
    id: 'usr-student-01',
    email: 'student@theautisticjourney.com',
    fullName: 'Verified Student',
    rollNumber: '23CS101',
    batchYear: '2023-2027',
    gender: 'Male',
    role: 'MEMBER',
    status: 'ACTIVE',
    createdAt: DateTime(2023, 9, 1),
    updatedAt: DateTime.now(),
  );

  static List<Album> get mockAlbums => [
        Album(
          id: 'album-001',
          title: 'Zyverse 2K26 - Day 1 Stage Events',
          description: 'National level symposium - opening ceremony and cultural show',
          academicYear: 'Third Year',
          category: 'Symposium',
          eventDate: DateTime(2026, 3, 15),
          coverUrl: 'https://picsum.photos/seed/zyverse1/800/600',
          createdAt: DateTime(2026, 3, 16),
          mediaCount: 347,
        ),
        Album(
          id: 'album-002',
          title: 'Induction Day 2023',
          description: 'First day of college - freshers orientation',
          academicYear: 'First Year',
          category: 'Induction',
          eventDate: DateTime(2023, 9, 1),
          coverUrl: 'https://picsum.photos/seed/induction/800/600',
          createdAt: DateTime(2023, 9, 2),
          mediaCount: 156,
        ),
        Album(
          id: 'album-003',
          title: 'Goa Trip - Batch 2027',
          description: 'Annual batch trip to Goa',
          academicYear: 'Second Year',
          category: 'Trips',
          eventDate: DateTime(2025, 1, 10),
          coverUrl: 'https://picsum.photos/seed/goatrip/800/600',
          createdAt: DateTime(2025, 1, 15),
          mediaCount: 892,
        ),
        Album(
          id: 'album-004',
          title: 'Hostel Block B Chronicles',
          description: 'Random hostel memories throughout the years',
          academicYear: 'Second Year',
          category: 'Hostel',
          eventDate: DateTime(2024, 6, 15),
          coverUrl: 'https://picsum.photos/seed/hostel/800/600',
          createdAt: DateTime(2024, 7, 1),
          mediaCount: 423,
        ),
      ];

  static List<MediaItem> mockMediaForAlbum(String albumId, int count) {
    return List.generate(
      count,
      (i) => MediaItem(
        id: '$albumId-media-${i.toString().padLeft(3, '0')}',
        albumId: albumId,
        uploaderId: 'demo-user-001',
        uploaderName: 'Demo User',
        originalS3Key: 'originals/2026/$albumId/${i}_original.jpg',
        thumbUrl: 'https://picsum.photos/seed/$albumId$i/256/256',
        previewUrl: 'https://picsum.photos/seed/$albumId$i/1600/1200',
        originalUrl: 'https://picsum.photos/seed/$albumId$i/3200/2400',
        fileName: 'IMG_${1000 + i}.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 2500000 + (i * 100000),
        sha256Hash: 'mock_hash_${albumId}_$i',
        width: 3200,
        height: 2400,
        takenAt: DateTime(2026, 3, 15, 10 + (i ~/ 60), i % 60),
        uploadedAt: DateTime(2026, 3, 16, 14, i),
      ),
    );
  }
}
