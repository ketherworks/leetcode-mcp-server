import { LeetCodeSite } from "./cli.js";
import { LeetCodeBaseService } from "./leetcode/leetcode-base-service.js";
import { LeetCodeServiceFactory } from "./leetcode/leetcode-service-factory.js";

export interface LeetCodeFactory {
    createService(
        site: string,
        sessionCookie?: string
    ): Promise<LeetCodeBaseService>;
}

export async function createAnonymousService(
    site: LeetCodeSite,
    factory: LeetCodeFactory = LeetCodeServiceFactory
): Promise<LeetCodeBaseService> {
    const service = await factory.createService(site, undefined);
    if (service.isAuthenticated()) {
        throw new Error("Anonymous LeetCode service assertion failed.");
    }
    return service;
}
