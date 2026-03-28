export function inferDatabase(features) {
  const normalizedFeatures = Array.isArray(features) ? features : [];
  const schema = {};

  if (normalizedFeatures.includes('auth')) {
    schema.users = ['id', 'email', 'password'];
  }

  if (normalizedFeatures.includes('payments')) {
    schema.subscriptions = ['user_id', 'plan', 'status'];
  }

  return schema;
}

export default {
  inferDatabase,
};
