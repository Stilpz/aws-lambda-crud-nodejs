export const makeListTasks = ({ taskRepository }) =>
    ({ ownerId, limit, cursor }) => taskRepository.listByOwner(ownerId, { limit, cursor });
