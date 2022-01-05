import {IBaseServiceResponseModel, RbsServiceResponse} from "../../src/Responses/RbsServiceResponse";


describe('BaseServiceResponseModel tests', function () {
    test('Create a new model', async () => {

        class ExampleModelClass extends RbsServiceResponse<{exampleData: string}>{
            constructor(props: IBaseServiceResponseModel<{exampleData: string}>) {
                super(props);
            }
        }

        const exampleClassModel = new ExampleModelClass({statusCode: 200, result: {exampleData: "one"}});

        expect(exampleClassModel.result!.exampleData).toEqual("one")

    })
});