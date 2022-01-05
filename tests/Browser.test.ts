import RBS from "../src";
import * as dotenv from "dotenv";
import {Browser} from "../src/Workers/Browser";


dotenv.config()

describe('Browser tests', function () {
    let rbs: RBS;
    let browser: Browser;
    global["window"] = Object.create({})
    global["localStorage"] = Object.create({
        setItem: () => {
        },
        getItem: () => {
        }
    })
    beforeAll(function () {
        rbs = new RBS({
            enableLogs: true, auth: {apiKey: process.env.TEST_API_KEY},
            domain: process.env.TEST_DOMAIN
        });
    })

    describe('Client access token test', function () {
        let dummyLocalStorage: Map<string, any>;
        beforeEach(function () {
            browser = new Browser();
            dummyLocalStorage = new Map<string, any>();
            spyOn(localStorage, 'setItem',).and.callFake(function (key: string, value: string) {
                dummyLocalStorage.set(key, value)
            })
            spyOn(localStorage, 'getItem').and.callFake(function (key: string) {
                dummyLocalStorage.get(key)
            })
        })

        test('Client authenticate browser operation success', async () => {
            const userId = "DummyUserFromRbsSdkTest"
            const resp = await rbs.server.main.generateCustomToken(userId)
            expect(resp.result).toBeDefined()

            await rbs.client.main.clientAuthenticate(resp.result!.customToken)

            const user = await rbs.client.main.getUser()
            expect(user).toBeDefined()
            expect(user.userId).toEqual(userId)

            console.log(dummyLocalStorage.entries())
            const res = await rbs.client.product.search()
            console.log(res.result)


        }, (60 * 1000))
    })
})
