// Chave PÚBLICA do Google Maps para o autocompletar de endereço no navegador.
// É pública por natureza (fica no site), mas deve ser RESTRITA no Google Cloud
// ao domínio www.dupuroacai.com/* e só às APIs Maps JavaScript + Places.
// A chave do SERVIDOR (geocoding/distância/rotas) é outra e fica só no secret
// GOOGLE_MAPS_KEY das Edge Functions — nunca aqui.
// Vazia = sem autocompletar (o cliente digita e o servidor localiza o endereço).
window.DUPURO_GOOGLE_MAPS_KEY = '';
