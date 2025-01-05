// Cloud-native provisioning for the Foundry / Azure OpenAI resource (Criterion 3).
// Deploy: az deployment group create -g <rg> --template-file infra/main.bicep --parameters infra/main.parameters.json
// Or with azd: azd provision

@description('Base name for the AI resource (must be globally unique-ish).')
param name string = 'foundry${uniqueString(resourceGroup().id)}'

@description('Azure region. Pick one where your model is available.')
param location string = resourceGroup().location

@description('Model deployment name to create.')
param modelName string = 'gpt-4o'

@description('Model version (region-dependent).')
param modelVersion string = '2024-08-06'

@description('Throughput in thousands of tokens per minute.')
param capacity int = 20

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // Required for keyless Microsoft Entra ID auth (recommended).
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
  }
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: modelName
  sku: {
    name: 'GlobalStandard'
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
  }
}

@description('Set this as AZURE_OPENAI_ENDPOINT in your .env')
output endpoint string = account.properties.endpoint

@description('Set this as AZURE_OPENAI_DEPLOYMENT in your .env')
output deploymentName string = deployment.name
