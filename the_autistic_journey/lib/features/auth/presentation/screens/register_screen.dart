import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme_tokens.dart';
import '../../providers/auth_provider.dart';

/// Registration screen (FR-A01) with editorial dark design.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _rollNumberController = TextEditingController();
  String _selectedBatchYear = '2023-2027';
  String? _selectedGender;

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _rollNumberController.dispose();
    super.dispose();
  }

  void _handleRegister() {
    if (_formKey.currentState?.validate() ?? false) {
      ref.read(authProvider.notifier).register(
            fullName: _fullNameController.text.trim(),
            email: _emailController.text.trim(),
            password: _passwordController.text,
            rollNumber: _rollNumberController.text.trim(),
            batchYear: _selectedBatchYear,
            gender: _selectedGender,
          );
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final isLoading = authState.status == AuthStatus.loading;
    final isWide = MediaQuery.of(context).size.width > 700;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(40),
          child: SizedBox(
            width: isWide ? 500 : double.infinity,
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Back button
                  IconButton(
                    onPressed: () => context.go('/login'),
                    icon: const Icon(Icons.arrow_back, color: AppColors.textDim),
                  ).animate().fadeIn(duration: 400.ms),

                  const SizedBox(height: 20),

                  Text(
                    'ARCHIVE REGISTRATION',
                    style: AppTextStyles.labelMedium,
                  ).animate().fadeIn(duration: 600.ms, delay: 100.ms),

                  const SizedBox(height: 8),

                  Text(
                    'REQUEST\nACCESS',
                    style: AppTextStyles.displayMedium,
                  ).animate().fadeIn(duration: 800.ms, delay: 200.ms),

                  const SizedBox(height: 12),

                  Text(
                    'Your registration will be reviewed by a batch administrator before access is granted.',
                    style: AppTextStyles.bodySmall,
                  ).animate().fadeIn(duration: 600.ms, delay: 300.ms),

                  const SizedBox(height: 40),

                  // Full Name
                  _buildField(
                    label: 'FULL NAME',
                    hint: 'Enter your full name',
                    controller: _fullNameController,
                    validator: (v) => v == null || v.isEmpty ? 'Required' : null,
                    delay: 400,
                  ),
                  const SizedBox(height: 24),

                  // Email
                  _buildField(
                    label: 'INSTITUTIONAL EMAIL',
                    hint: 'your.name@college.edu',
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Required';
                      if (!v.contains('@')) return 'Invalid email';
                      return null;
                    },
                    delay: 500,
                  ),
                  const SizedBox(height: 24),

                  // Roll Number
                  _buildField(
                    label: 'COLLEGE ROLL / REGISTRATION NO',
                    hint: 'CS2023001',
                    controller: _rollNumberController,
                    validator: (v) => v == null || v.isEmpty ? 'Required' : null,
                    delay: 600,
                  ),
                  const SizedBox(height: 24),

                  // Batch Year dropdown
                  _buildDropdown(
                    label: 'BATCH YEAR',
                    value: _selectedBatchYear,
                    items: const ['2022-2026', '2023-2027', '2024-2028', '2025-2029'],
                    onChanged: (v) => setState(() => _selectedBatchYear = v!),
                    delay: 700,
                  ),
                  const SizedBox(height: 24),

                  // Gender dropdown
                  _buildDropdown(
                    label: 'GENDER (OPTIONAL)',
                    value: _selectedGender,
                    items: const ['Male', 'Female', 'Non-binary', 'Prefer not to say'],
                    onChanged: (v) => setState(() => _selectedGender = v),
                    delay: 750,
                  ),
                  const SizedBox(height: 24),

                  // Password
                  _buildField(
                    label: 'SEQUENCE KEY',
                    hint: '••••••••',
                    controller: _passwordController,
                    isPassword: true,
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Required';
                      if (v.length < 8) return 'Min 8 characters';
                      return null;
                    },
                    delay: 800,
                  ),
                  const SizedBox(height: 24),

                  // Confirm Password
                  _buildField(
                    label: 'CONFIRM SEQUENCE KEY',
                    hint: '••••••••',
                    controller: _confirmPasswordController,
                    isPassword: true,
                    validator: (v) {
                      if (v != _passwordController.text) {
                        return 'Keys do not match';
                      }
                      return null;
                    },
                    delay: 900,
                  ),
                  const SizedBox(height: 48),

                  // Submit button
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      onPressed: isLoading ? null : _handleRegister,
                      child: isLoading
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.black,
                              ),
                            )
                          : const Text('SUBMIT REGISTRATION'),
                    ),
                  ).animate().fadeIn(duration: 600.ms, delay: 1000.ms),

                  const SizedBox(height: 24),

                  Center(
                    child: TextButton(
                      onPressed: () => context.go('/login'),
                      child: Text(
                        'ALREADY REGISTERED? INITIALIZE STREAM',
                        style: AppTextStyles.labelSmall.copyWith(
                          color: AppColors.textDim,
                        ),
                      ),
                    ),
                  ).animate().fadeIn(duration: 400.ms, delay: 1100.ms),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildField({
    required String label,
    required String hint,
    required TextEditingController controller,
    bool isPassword = false,
    TextInputType? keyboardType,
    String? Function(String?)? validator,
    required int delay,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.labelMedium),
        const SizedBox(height: 8),
        TextFormField(
          controller: controller,
          obscureText: isPassword,
          keyboardType: keyboardType,
          validator: validator,
          style: const TextStyle(
            fontSize: 16,
            color: AppColors.textPrimary,
          ),
          decoration: InputDecoration(
            hintText: hint,
          ),
        ),
      ],
    ).animate().fadeIn(duration: 500.ms, delay: Duration(milliseconds: delay));
  }

  Widget _buildDropdown({
    required String label,
    required String? value,
    required List<String> items,
    required ValueChanged<String?> onChanged,
    required int delay,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.labelMedium),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          initialValue: value,
          dropdownColor: AppColors.surfaceElevated,
          style: const TextStyle(
            fontSize: 16,
            color: AppColors.textPrimary,
          ),
          items: items
              .map((item) => DropdownMenuItem(value: item, child: Text(item)))
              .toList(),
          onChanged: onChanged,
        ),
      ],
    ).animate().fadeIn(duration: 500.ms, delay: Duration(milliseconds: delay));
  }
}
