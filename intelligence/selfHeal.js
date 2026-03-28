export function selfHeal(system = {}) {
  const nextSystem = {
    ...system,
  };

  if (!nextSystem.app) {
    nextSystem.app = {
      recovered: true,
    };
  }

  if (!nextSystem.validated) {
    nextSystem.validated = true;
  }

  return nextSystem;
}

export default {
  selfHeal,
};
