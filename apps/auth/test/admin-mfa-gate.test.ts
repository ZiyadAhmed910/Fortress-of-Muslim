import { describe, expect, it } from 'vitest';
import { requiresMfaEnrollment } from '../src/admin-plane';

describe('admin MFA enforcement gate (0.20 item 6)', () => {
  it('blocks an admin without MFA from every admin route except their own session view', () => {
    expect(requiresMfaEnrollment('admin', false, '/v1/admin/overview', 'GET')).toBe(true);
    expect(requiresMfaEnrollment('admin', false, '/v1/admin/editorial/queue', 'GET')).toBe(true);
    expect(requiresMfaEnrollment('admin', false, '/v1/admin/services/api', 'PATCH')).toBe(true);
  });

  it('always lets an admin without MFA read their own session status', () => {
    expect(requiresMfaEnrollment('admin', false, '/v1/admin/session', 'GET')).toBe(false);
  });

  it('never blocks an admin who already has MFA enabled', () => {
    expect(requiresMfaEnrollment('admin', true, '/v1/admin/overview', 'GET')).toBe(false);
    expect(requiresMfaEnrollment('admin', true, '/v1/admin/services/api', 'PATCH')).toBe(false);
  });

  it('leaves editor and reviewer roles optional regardless of MFA status', () => {
    expect(requiresMfaEnrollment('editor', false, '/v1/admin/editorial/queue', 'GET')).toBe(false);
    expect(requiresMfaEnrollment('reviewer', false, '/v1/admin/editorial/queue', 'GET')).toBe(false);
  });

  it('is false for a null role (the earlier role/status check already rejects this case)', () => {
    expect(requiresMfaEnrollment(null, false, '/v1/admin/overview', 'GET')).toBe(false);
  });
});
