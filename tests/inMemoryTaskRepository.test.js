import { InMemoryTaskRepository } from "./inMemoryTaskRepository.js";
import { describeTaskRepositoryContract } from "./taskRepositoryContract.js";

describeTaskRepositoryContract("InMemoryTaskRepository", () => new InMemoryTaskRepository());
