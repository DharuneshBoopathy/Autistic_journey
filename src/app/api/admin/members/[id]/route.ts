import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { approveMember, rejectMember, setMemberRole, setMemberStatus } from '@/lib/admin';

export const runtime = 'nodejs';

/**
 * One endpoint per member, with the action in the body.
 *
 * `invalid` is the one failure that does not collapse to 404: it means the caller is
 * an admin acting on a member they can see, and the request itself was wrong —
 * approving an already-active account, or suspending themselves. Saying so is
 * helpful and leaks nothing they did not already know.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('suspend') }),
  z.object({ action: z.literal('reinstate') }),
  z.object({ action: z.literal('setRole'), role: z.enum(['member', 'moderator', 'admin']) }),
]);

const INVALID_MESSAGE: Record<string, string> = {
  approve: 'That account is not awaiting approval.',
  reject: 'That account is not awaiting approval.',
  suspend: 'You cannot suspend your own account.',
  setRole: 'You cannot change your own role.',
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const memberId = (await params).id;
  const input = body.data;

  const result = await (() => {
    switch (input.action) {
      case 'approve':
        return approveMember(auth.user, memberId);
      case 'reject':
        return rejectMember(auth.user, memberId);
      case 'suspend':
        return setMemberStatus(auth.user, memberId, 'suspended');
      case 'reinstate':
        return setMemberStatus(auth.user, memberId, 'active');
      case 'setRole':
        return setMemberRole(auth.user, memberId, input.role);
    }
  })();

  if (!result.ok) {
    return json(
      {
        error:
          result.reason === 'invalid'
            ? (INVALID_MESSAGE[input.action] ?? 'That action is not valid here.')
            : 'Not found.',
      },
      { status: failureStatus(result.reason) },
    );
  }

  return json({ ok: true });
}
