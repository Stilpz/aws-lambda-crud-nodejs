export const makeUpdateTask = ({ taskRepository }) =>
    ({ ownerId, id, changes }) => taskRepository.update(ownerId, id, changes);
