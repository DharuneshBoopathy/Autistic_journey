import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme_tokens.dart';
import '../../providers/auth_provider.dart';

/// Mercury-inspired login screen from login.txt merged with Nite Riot dark aesthetic.
/// Features: floating mercury blobs, glowing input underlines, gooey button effect.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen>
    with TickerProviderStateMixin {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _emailFocus = FocusNode();
  final _passwordFocus = FocusNode();
  bool _emailFocused = false;
  bool _passwordFocused = false;
  bool _isHoveringButton = false;

  late final List<_BlobData> _blobs;
  late final List<AnimationController> _blobControllers;

  @override
  void initState() {
    super.initState();
    final rng = Random(42);
    _blobs = List.generate(6, (i) {
      return _BlobData(
        size: rng.nextDouble() * 200 + 150,
        left: rng.nextDouble() * 80 + 10,
        top: rng.nextDouble() * 80 + 10,
      );
    });

    _blobControllers = List.generate(6, (i) {
      return AnimationController(
        vsync: this,
        duration: Duration(seconds: 15 + rng.nextInt(15)),
      )..repeat(reverse: true);
    });

    _emailFocus.addListener(() {
      setState(() => _emailFocused = _emailFocus.hasFocus);
    });
    _passwordFocus.addListener(() {
      setState(() => _passwordFocused = _passwordFocus.hasFocus);
    });
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _emailFocus.dispose();
    _passwordFocus.dispose();
    for (final c in _blobControllers) {
      c.dispose();
    }
    super.dispose();
  }

  void _handleLogin() {
    ref.read(authProvider.notifier).login(
          _emailController.text.trim(),
          _passwordController.text,
        );
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final size = MediaQuery.of(context).size;
    final isWide = size.width > 700;

    ref.listen<AuthState>(authProvider, (prev, next) {
      if (next.status == AuthStatus.error && next.errorMessage != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(next.errorMessage!)),
        );
      }
    });

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          // -- Background Mercury Blobs --
          ..._buildBlobs(size),

          // -- Main Content --
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(40),
              child: SizedBox(
                width: isWide ? 440 : double.infinity,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // -- Brand Identifier --
                    Text(
                      'SYSTEM NODE: TAJ-001',
                      style: AppTextStyles.labelMedium,
                    )
                        .animate()
                        .fadeIn(duration: 800.ms, delay: 200.ms)
                        .slideX(begin: -0.1, end: 0),

                    const SizedBox(height: 8),

                    // -- Title --
                    Text(
                      'THE\nAUTISTIC\nJOURNEY',
                      style: AppTextStyles.displayLarge.copyWith(
                        fontSize: isWide ? 64 : 48,
                      ),
                    )
                        .animate()
                        .fadeIn(duration: 1000.ms, delay: 400.ms)
                        .slideY(begin: 0.1, end: 0),

                    const SizedBox(height: 60),

                    // -- Email Field --
                    _buildInputField(
                      label: 'USER IDENTITY',
                      hint: 'batch-member@journey.edu',
                      controller: _emailController,
                      focusNode: _emailFocus,
                      isFocused: _emailFocused,
                      isPassword: false,
                      delay: 600,
                    ),

                    const SizedBox(height: 30),

                    // -- Password Field --
                    _buildInputField(
                      label: 'SEQUENCE KEY',
                      hint: '••••••••',
                      controller: _passwordController,
                      focusNode: _passwordFocus,
                      isFocused: _passwordFocused,
                      isPassword: true,
                      delay: 800,
                    ),

                    const SizedBox(height: 50),

                    // -- Mercury Button --
                    _buildMercuryButton(authState),

                    const SizedBox(height: 40),

                    // -- Footer Links --
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        TextButton(
                          onPressed: () {},
                          child: Text(
                            'ENCRYPTED RECOVERY',
                            style: AppTextStyles.labelSmall.copyWith(
                              color: AppColors.textDim,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: () => context.go('/register'),
                          child: Text(
                            'NEW ARCHIVE',
                            style: AppTextStyles.labelSmall.copyWith(
                              color: AppColors.textDim,
                            ),
                          ),
                        ),
                      ],
                    )
                        .animate()
                        .fadeIn(duration: 600.ms, delay: 1200.ms),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInputField({
    required String label,
    required String hint,
    required TextEditingController controller,
    required FocusNode focusNode,
    required bool isFocused,
    required bool isPassword,
    required int delay,
  }) {
    return AnimatedContainer(
      duration: AppDurations.slow,
      curve: AppCurves.smooth,
      transform: Matrix4.translationValues(isFocused ? 10 : 0, 0, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppTextStyles.labelMedium.copyWith(
              letterSpacing: 3,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: controller,
            focusNode: focusNode,
            obscureText: isPassword,
            style: const TextStyle(
              fontSize: 18,
              color: AppColors.textPrimary,
            ),
            decoration: InputDecoration(
              hintText: hint,
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
            ),
            onSubmitted: isPassword ? (_) => _handleLogin() : null,
          ),
          // Animated underline glow
          Stack(
            children: [
              Container(
                height: 1,
                color: AppColors.divider,
              ),
              AnimatedFractionallySizedBox(
                duration: const Duration(milliseconds: 600),
                curve: AppCurves.smooth,
                alignment: Alignment.centerLeft,
                widthFactor: isFocused ? 1.0 : 0.0,
                child: Container(
                  height: 2,
                  decoration: BoxDecoration(
                    color: AppColors.mercury,
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.mercury.withValues(alpha: 0.5),
                        blurRadius: 15,
                        spreadRadius: 0,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    ).animate().fadeIn(duration: 600.ms, delay: Duration(milliseconds: delay));
  }

  Widget _buildMercuryButton(AuthState authState) {
    final isLoading = authState.status == AuthStatus.loading;

    return MouseRegion(
      onEnter: (_) => setState(() => _isHoveringButton = true),
      onExit: (_) => setState(() => _isHoveringButton = false),
      child: GestureDetector(
        onTap: isLoading ? null : _handleLogin,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 500),
          curve: AppCurves.bouncy,
          transform: Matrix4.diagonal3Values(
            _isHoveringButton ? 1.02 : 1.0,
            _isHoveringButton ? 1.05 : 1.0,
            1.0,
          ),
          child: Stack(
            children: [
              // Mercury drop background
              AnimatedContainer(
                duration: const Duration(milliseconds: 500),
                curve: AppCurves.bouncy,
                height: 60,
                decoration: BoxDecoration(
                  color: _isHoveringButton
                      ? AppColors.mercury
                      : AppColors.mercury.withValues(alpha: 0.9),
                  borderRadius: BorderRadius.circular(
                    _isHoveringButton ? 30 : 0,
                  ),
                  boxShadow: _isHoveringButton
                      ? [
                          BoxShadow(
                            color: AppColors.mercury.withValues(alpha: 0.3),
                            blurRadius: 30,
                            spreadRadius: 5,
                          ),
                        ]
                      : [],
                ),
              ),
              // Button content
              SizedBox(
                height: 60,
                child: Center(
                  child: isLoading
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.black,
                          ),
                        )
                      : AnimatedDefaultTextStyle(
                          duration: AppDurations.normal,
                          style: AppTextStyles.buttonLarge.copyWith(
                            letterSpacing: _isHoveringButton ? 6 : 2,
                          ),
                          child: const Text('INITIALIZE STREAM'),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    ).animate().fadeIn(duration: 600.ms, delay: 1000.ms).slideY(begin: 0.2);
  }

  List<Widget> _buildBlobs(Size screenSize) {
    return List.generate(_blobs.length, (i) {
      final blob = _blobs[i];
      return AnimatedBuilder(
        animation: _blobControllers[i],
        builder: (context, child) {
          final t = _blobControllers[i].value;
          final dx = sin(t * pi * 2) * 50;
          final dy = cos(t * pi * 2 + i) * 40;
          final scale = 0.8 + sin(t * pi) * 0.4;

          return Positioned(
            left: screenSize.width * blob.left / 100 + dx,
            top: screenSize.height * blob.top / 100 + dy,
            child: Transform.scale(
              scale: scale,
              child: Container(
                width: blob.size,
                height: blob.size,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0x40E0E0E0),
                      Color(0x20888888),
                    ],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.5),
                      blurRadius: 20,
                      offset: const Offset(-10, -10),
                    ),
                    BoxShadow(
                      color: Colors.white.withValues(alpha: 0.05),
                      blurRadius: 30,
                      offset: const Offset(10, 10),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      );
    });
  }
}

class _BlobData {
  final double size;
  final double left;
  final double top;

  const _BlobData({
    required this.size,
    required this.left,
    required this.top,
  });
}
