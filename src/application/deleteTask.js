export const makeDeleteTask = ({ taskRepository }) =>
    ({ ownerId, id }) => taskRepository.delete(ownerId, id);
