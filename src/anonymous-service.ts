import { LeetCodeSite } from "./cli.js";
import { LeetCodeServiceFactory } from "./leetcode/leetcode-service-factory.js";
import { AnonymousLeetCodeService } from "./oj/service.js";

export interface LeetCodeFactory {
    createService(
        site: string,
        sessionCookie?: string
    ): Promise<AnonymousLeetCodeService>;
}

export async function createAnonymousService(
    site: LeetCodeSite,
    factory: LeetCodeFactory = LeetCodeServiceFactory
): Promise<AnonymousLeetCodeService> {
    const service = await factory.createService(site, undefined);
    if (service.isAuthenticated()) {
        throw new Error("Anonymous LeetCode service assertion failed.");
    }
    return service;
}
