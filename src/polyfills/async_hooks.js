
export class AsyncLocalStorage {
    run(store, callback, ...args) {
        return callback(...args);
    }
    getStore() {
        return undefined;
    }
}
