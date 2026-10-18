import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../models/album_model.dart';
import '../../../core/services/api_service.dart';

/// Gallery state holding albums organized by academic year.
class GalleryState {
  final bool isLoading;
  final List<Album> albums;
  final String selectedYear;
  final String? selectedCategory;
  final String? errorMessage;

  const GalleryState({
    this.isLoading = false,
    this.albums = const [],
    this.selectedYear = 'All',
    this.selectedCategory,
    this.errorMessage,
  });

  GalleryState copyWith({
    bool? isLoading,
    List<Album>? albums,
    String? selectedYear,
    String? selectedCategory,
    String? errorMessage,
  }) {
    return GalleryState(
      isLoading: isLoading ?? this.isLoading,
      albums: albums ?? this.albums,
      selectedYear: selectedYear ?? this.selectedYear,
      selectedCategory: selectedCategory,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }

  List<Album> get filteredAlbums {
    var result = albums;
    if (selectedYear != 'All') {
      result = result.where((a) => a.academicYear == selectedYear).toList();
    }
    if (selectedCategory != null && selectedCategory!.isNotEmpty && selectedCategory != 'All') {
      result = result.where((a) => a.category == selectedCategory).toList();
    }
    return result;
  }

  int get totalMediaCount => albums.fold(0, (sum, a) => sum + a.mediaCount);
}

class GalleryNotifier extends StateNotifier<GalleryState> {
  GalleryNotifier() : super(const GalleryState());

  /// Load all albums from backend API.
  Future<void> loadAlbums() async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final albums = await apiService.getAlbums(
        academicYear: state.selectedYear == 'All' ? null : state.selectedYear,
        category: state.selectedCategory == 'All' ? null : state.selectedCategory,
      );
      state = state.copyWith(
        isLoading: false,
        albums: albums,
      );
    } catch (e) {
      // In offline/test fallback mode
      state = state.copyWith(
        isLoading: false,
        errorMessage: 'Failed to load albums from API: $e',
      );
    }
  }

  void selectYear(String year) {
    state = state.copyWith(selectedYear: year);
    loadAlbums();
  }

  void selectCategory(String? category) {
    state = state.copyWith(selectedCategory: category);
    loadAlbums();
  }

  void addAlbum(Album album) {
    state = state.copyWith(
      albums: [album, ...state.albums],
    );
  }

  void addMediaToAlbum(String albumId, List<MediaItem> newItems) {
    final updated = state.albums.map((a) {
      if (a.id == albumId) {
        return Album(
          id: a.id,
          title: a.title,
          description: a.description,
          academicYear: a.academicYear,
          category: a.category,
          eventDate: a.eventDate,
          coverUrl: newItems.isNotEmpty ? newItems.first.thumbUrl : a.coverUrl,
          createdAt: a.createdAt,
          mediaCount: a.mediaCount + newItems.length,
        );
      }
      return a;
    }).toList();

    state = state.copyWith(albums: updated);
  }
}

final galleryProvider =
    StateNotifierProvider<GalleryNotifier, GalleryState>((ref) {
  return GalleryNotifier();
});

/// Provider for media items within a specific album.
class AlbumMediaState {
  final bool isLoading;
  final List<MediaItem> items;
  final String albumId;
  final String? errorMessage;

  const AlbumMediaState({
    this.isLoading = false,
    this.items = const [],
    this.albumId = '',
    this.errorMessage,
  });

  AlbumMediaState copyWith({
    bool? isLoading,
    List<MediaItem>? items,
    String? albumId,
    String? errorMessage,
  }) {
    return AlbumMediaState(
      isLoading: isLoading ?? this.isLoading,
      items: items ?? this.items,
      albumId: albumId ?? this.albumId,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class AlbumMediaNotifier extends StateNotifier<AlbumMediaState> {
  AlbumMediaNotifier() : super(const AlbumMediaState());

  Future<void> loadMedia(String albumId) async {
    state = AlbumMediaState(isLoading: true, albumId: albumId);
    try {
      final items = await apiService.getAlbumMedia(albumId);
      state = AlbumMediaState(
        isLoading: false,
        albumId: albumId,
        items: items,
      );
    } catch (e) {
      state = AlbumMediaState(
        isLoading: false,
        albumId: albumId,
        items: const [],
        errorMessage: 'Failed to load media: $e',
      );
    }
  }

  void addMediaItems(String albumId, List<MediaItem> newItems) {
    if (state.albumId == albumId) {
      state = state.copyWith(items: [...newItems, ...state.items]);
    }
  }

  void removeMediaItem(String albumId, String mediaId) {
    if (state.albumId == albumId) {
      state = state.copyWith(
        items: state.items.where((m) => m.id != mediaId).toList(),
      );
    }
  }
}

final albumMediaProvider =
    StateNotifierProvider<AlbumMediaNotifier, AlbumMediaState>((ref) {
  return AlbumMediaNotifier();
});
