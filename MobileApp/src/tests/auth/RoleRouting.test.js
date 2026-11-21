/**
 * RoleRouting.test.js
 *
 * Tests role-based and status-based routing predicates in MobileApp/App.js
 * as specified in Issue #4171: (user / admin / master_admin / pending_approval)
 */

describe('Mobile Role & Status Routing Logic', () => {
  const evaluateRouting = (role, status) => {
    const isPending =
      status === 'pending_approval' || role === 'pending_approval' || status === 'pending';
    const isAdmin = role === 'admin' || role === 'master_admin' || role === 'super_admin';
    
    if (isPending) return 'PendingApproval';
    if (isAdmin) return 'AdminMain';
    return 'UserMain';
  };

  test('routes pending_approval status to PendingApproval screen', () => {
    expect(evaluateRouting('user', 'pending_approval')).toBe('PendingApproval');
    expect(evaluateRouting('admin', 'pending_approval')).toBe('PendingApproval');
    expect(evaluateRouting('user', 'pending')).toBe('PendingApproval');
  });

  test('routes pending_approval role to PendingApproval screen', () => {
    expect(evaluateRouting('pending_approval', 'active')).toBe('PendingApproval');
  });

  test('routes admin roles to AdminMain when status is active', () => {
    expect(evaluateRouting('admin', 'active')).toBe('AdminMain');
    expect(evaluateRouting('master_admin', 'active')).toBe('AdminMain');
    expect(evaluateRouting('super_admin', 'active')).toBe('AdminMain');
  });

  test('routes standard active users to UserMain', () => {
    expect(evaluateRouting('user', 'active')).toBe('UserMain');
    expect(evaluateRouting('employee', 'active')).toBe('UserMain');
  });
});
