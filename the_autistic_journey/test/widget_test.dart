import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:the_autistic_journey/main.dart';

void main() {
  testWidgets('App launches smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: TheAutisticJourneyApp(),
      ),
    );
    await tester.pump(const Duration(seconds: 2));
    expect(find.byType(TheAutisticJourneyApp), findsOneWidget);
  });
}
