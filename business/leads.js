const leads = [];

export function captureLead(email) {
  leads.push({
    email,
    date: Date.now(),
  });
}

export default {
  captureLead,
};
