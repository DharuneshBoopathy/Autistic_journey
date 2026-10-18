/// User model matching the PostgreSQL `users` table (Section 6).
class User {
  final String id;
  final String email;
  final String fullName;
  final String? rollNumber;
  final String batchYear;
  final String? gender;
  final String role;     // SUPER_ADMIN, MODERATOR, MEMBER, READ_ONLY
  final String status;   // PENDING_APPROVAL, ACTIVE, SUSPENDED
  final String? avatarUrl;
  final DateTime createdAt;
  final DateTime updatedAt;

  const User({
    required this.id,
    required this.email,
    required this.fullName,
    this.rollNumber,
    required this.batchYear,
    this.gender,
    this.role = 'MEMBER',
    this.status = 'PENDING_APPROVAL',
    this.avatarUrl,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isSuperAdmin => role == 'SUPER_ADMIN';
  bool get isModerator => role == 'MODERATOR';
  bool get isActive => status == 'ACTIVE';
  bool get isPending => status == 'PENDING_APPROVAL';

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String? ?? '',
        email: json['email'] as String? ?? '',
        fullName: json['full_name'] as String? ?? 'Student',
        rollNumber: json['roll_number'] as String?,
        batchYear: json['batch_year'] as String? ?? '2023-2027',
        gender: json['gender'] as String?,
        role: json['role'] as String? ?? 'MEMBER',
        status: json['status'] as String? ?? 'PENDING_APPROVAL',
        avatarUrl: json['avatar_url'] as String?,
        createdAt: json['created_at'] != null
            ? (DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now())
            : DateTime.now(),
        updatedAt: json['updated_at'] != null
            ? (DateTime.tryParse(json['updated_at'].toString()) ?? DateTime.now())
            : DateTime.now(),
      );


  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'full_name': fullName,
        'roll_number': rollNumber,
        'batch_year': batchYear,
        'gender': gender,
        'role': role,
        'status': status,
        'avatar_url': avatarUrl,
        'created_at': createdAt.toIso8601String(),
        'updated_at': updatedAt.toIso8601String(),
      };

  User copyWith({
    String? id,
    String? email,
    String? fullName,
    String? rollNumber,
    String? batchYear,
    String? gender,
    String? role,
    String? status,
    String? avatarUrl,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return User(
      id: id ?? this.id,
      email: email ?? this.email,
      fullName: fullName ?? this.fullName,
      rollNumber: rollNumber ?? this.rollNumber,
      batchYear: batchYear ?? this.batchYear,
      gender: gender ?? this.gender,
      role: role ?? this.role,
      status: status ?? this.status,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
