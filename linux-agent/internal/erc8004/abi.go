package erc8004

import (
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

const registryABIJSON = `[
  {"type":"function","name":"register","stateMutability":"nonpayable","inputs":[
    {"name":"agentURI","type":"string"},
    {"name":"metadata","type":"tuple[]","components":[
      {"name":"metadataKey","type":"string"},
      {"name":"metadataValue","type":"bytes"}
    ]}
  ],"outputs":[{"name":"agentId","type":"uint256"}]},
  {"type":"function","name":"register","stateMutability":"nonpayable","inputs":[
    {"name":"agentURI","type":"string"}
  ],"outputs":[{"name":"agentId","type":"uint256"}]},
  {"type":"function","name":"safeTransferFrom","stateMutability":"nonpayable","inputs":[
    {"name":"from","type":"address"},
    {"name":"to","type":"address"},
    {"name":"tokenId","type":"uint256"}
  ],"outputs":[]},
  {"type":"function","name":"ownerOf","stateMutability":"view","inputs":[{"name":"tokenId","type":"uint256"}],"outputs":[{"name":"","type":"address"}]},
  {"type":"function","name":"getMetadata","stateMutability":"view","inputs":[
    {"name":"agentId","type":"uint256"},
    {"name":"metadataKey","type":"string"}
  ],"outputs":[{"name":"","type":"bytes"}]},
  {"type":"event","name":"Registered","inputs":[
    {"name":"agentId","type":"uint256","indexed":true},
    {"name":"agentURI","type":"string","indexed":false},
    {"name":"owner","type":"address","indexed":true}
  ]}
]`

var (
	registryABI     = mustABI(registryABIJSON)
	registeredTopic = crypto.Keccak256Hash([]byte("Registered(uint256,string,address)"))
)

func mustABI(raw string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(raw))
	if err != nil {
		panic(err)
	}
	return parsed
}

func topicAddress(addr string) string {
	return "0x" + common.Bytes2Hex(common.LeftPadBytes(common.HexToAddress(addr).Bytes(), 32))
}
