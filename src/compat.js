Map.groupBy ??= (values, getKey) => {
  const groups = new Map();
  let index = 0;
  for (const value of values) {
    const key = getKey(value, index++);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
};
