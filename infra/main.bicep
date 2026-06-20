// Cloud-native provisioning for ShipScribe (Criterion 3).
//
// Provisions, in one resource group:
//   - Azure AI Foundry / Azure OpenAI (AIServices) + a model deployment
//   - Log Analytics + Container Apps Environment
//   - Azure Container Registry (for the app image)
//   - a user-assigned managed identity with KEYLESS access to Foundry (no keys!)
//   - the ShipScribe web Container App (streaming SSE server)
//
// Deploy with azd:   azd up
// Or with az CLI:    az deployment group create -g <rg> \
//                      --template-file infra/main.bicep \
//                      --parameters infra/main.parameters.json

@description('azd environment name; used for tagging and resource naming.')
param environmentName string

@description('Azure region. Pick one where your model is available.')
param location string = resourceGroup().location

@description('Model deployment name to create.')
param modelName string = 'gpt-4o'

@description('Model version (region-dependent).')
param modelVersion string = '2024-08-06'

@description('Throughput in thousands of tokens per minute.')
param capacity int = 20

@description('Container image for the web app. azd overrides this on deploy; the default lets the first provision succeed.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

var resourceToken = toLower(uniqueString(subscription().id, resourceGroup().id, environmentName))
var tags = { 'azd-env-name': environmentName }

// Built-in role definition IDs.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User

// ---------------------------------------------------------------------------
// Microsoft Foundry / Azure OpenAI
// ---------------------------------------------------------------------------
resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'aoai${resourceToken}'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: 'aoai${resourceToken}' // required for keyless Entra ID auth
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: modelName
  sku: { name: 'GlobalStandard', capacity: capacity }
  properties: {
    model: { format: 'OpenAI', name: modelName, version: modelVersion }
  }
}

// ---------------------------------------------------------------------------
// Observability + Container Apps environment
// ---------------------------------------------------------------------------
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    sku: { name: 'PerGB2018' }
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Registry + keyless identity
// ---------------------------------------------------------------------------
resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: 'acr${resourceToken}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${resourceToken}'
  location: location
  tags: tags
}

// The app's identity can PULL images from the registry...
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, uami.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ...and call Foundry with NO API KEY (keyless Entra ID, Criterion 3 & 6).
resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, uami.id, openAiUserRoleId)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// The ShipScribe web app (streaming SSE server)
// ---------------------------------------------------------------------------
resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-web-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${uami.id}': {} }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 5173
        transport: 'auto'
      }
      registries: [
        { server: registry.properties.loginServer, identity: uami.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImage
          resources: { cpu: json('0.5'), memory: '1.0Gi' }
          env: [
            { name: 'PORT', value: '5173' }
            { name: 'SHIPSCRIBE_REPO', value: '/app' }
            { name: 'AZURE_OPENAI_ENDPOINT', value: account.properties.endpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: deployment.name }
            // Selects the user-assigned identity for DefaultAzureCredential (keyless).
            { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
  dependsOn: [acrPull, openAiUser]
}

// ---------------------------------------------------------------------------
// Outputs (azd reads these into the environment)
// ---------------------------------------------------------------------------
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.properties.loginServer
output AZURE_OPENAI_ENDPOINT string = account.properties.endpoint
output AZURE_OPENAI_DEPLOYMENT string = deployment.name
output WEB_URI string = 'https://${webApp.properties.configuration.ingress.fqdn}'
