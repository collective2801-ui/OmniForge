function normalizeTask(task, index) {
  if (typeof task === 'function') {
    return task;
  }

  if (task && typeof task.run === 'function') {
    return () => task.run();
  }

  throw new TypeError(
    `Parallel task at index ${index} must be a function or an object with a run() method.`,
  );
}

export async function runParallel(tasks = []) {
  if (!Array.isArray(tasks)) {
    throw new TypeError('runParallel(tasks) expects an array of tasks.');
  }

  const normalizedTasks = tasks.map((task, index) => normalizeTask(task, index));
  return Promise.all(normalizedTasks.map((task) => Promise.resolve().then(() => task())));
}

export default {
  runParallel,
};
