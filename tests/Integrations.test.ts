import * as dotenv from "dotenv"
import RBS from "../src";
import {MainServiceTypes} from "../src/Services/MainService/IMainService";
import RbsJwtToken = MainServiceTypes.RbsJwtToken;

dotenv.config()

describe('Rbs integration tests', function () {

    let rbs: RBS;

    beforeAll(() => {
        rbs = new RBS({
            enableLogs: true, auth: {apiKey: process.env.TEST_API_KEY},
            domain: process.env.TEST_DOMAIN
        });
    })

    describe('Tests with valid tokens', () => {

        let customToken: RbsJwtToken

        beforeAll(async () => {
            const response = await rbs.server.main.generateCustomToken("testUserFromSdkClient")
            expect(response.result).toBeDefined()
            customToken = response.result!.customToken
        })

        describe('Service tests', () => {
            let clientAccessToken: RbsJwtToken
            let clientRefreshToken: RbsJwtToken

            beforeAll(async () => {
                const clientAuth = await rbs.client.main.clientAuthenticate(customToken)
                expect(clientAuth.result).toBeDefined()
                expect(clientAuth.result!.refreshToken).toBeDefined()
                expect(clientAuth.result!.accessToken).toBeDefined()
                clientAccessToken = clientAuth.result!.accessToken
                clientRefreshToken = clientAuth.result!.refreshToken
            })

            describe("Main service tests", async () => {
                test('Client logout success', async () => {
                    const response = await rbs.client.main.clientLogout()
                    expect(response.result).toBeDefined()
                })
            })

            describe('Product service tests', async () => {
                test('Product search with valid client user', async () => {
                    const response = await rbs.client.product.search()
                    //expect(response.result).toBeDefined()
                })
            })
        })


    })
});