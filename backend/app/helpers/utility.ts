export class Utility {
    static async wait(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}