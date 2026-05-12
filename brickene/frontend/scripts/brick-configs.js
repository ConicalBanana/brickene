(() => {
  const frontend = window.BrickeneFrontend = window.BrickeneFrontend || {};

  // Mirrored from ../assets/brick_configs.json so the standalone frontend can read it without a build step.
  frontend.brickDefinitions = {
    "1": {
      alias: [],
      brick_type: "SKELETON",
      id: "1",
      name: "IT",
      edges: [[2, 11], [11, 12], [12, 4], [12, 13], [13, 14], [14, 15], [14, 16], [16, 17], [17, 18], [17, 19], [19, 20], [20, 21], [21, 10], [21, 22], [22, 23], [23, 24], [24, 25], [25, 26], [26, 27], [26, 28], [28, 3], [28, 29], [29, 1], [29, 30], [24, 31], [31, 5], [31, 6], [31, 32], [32, 33], [33, 9], [20, 34], [34, 7], [34, 8], [15, 11], [34, 16], [18, 13], [33, 19], [32, 22], [27, 23], [30, 25]],
      nodes: [
        { index: 2, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 11, kind: "atom", symbol: "C" },
        { index: 12, kind: "atom", symbol: "C" },
        { index: 4, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 13, kind: "atom", symbol: "C" },
        { index: 14, kind: "atom", symbol: "C" },
        { index: 15, kind: "atom", symbol: "S" },
        { index: 16, kind: "atom", symbol: "C" },
        { index: 17, kind: "atom", symbol: "C" },
        { index: 18, kind: "atom", symbol: "S" },
        { index: 19, kind: "atom", symbol: "C" },
        { index: 20, kind: "atom", symbol: "C" },
        { index: 21, kind: "atom", symbol: "C" },
        { index: 10, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 22, kind: "atom", symbol: "C" },
        { index: 23, kind: "atom", symbol: "C" },
        { index: 24, kind: "atom", symbol: "C" },
        { index: 25, kind: "atom", symbol: "C" },
        { index: 26, kind: "atom", symbol: "C" },
        { index: 27, kind: "atom", symbol: "S" },
        { index: 28, kind: "atom", symbol: "C" },
        { index: 3, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 29, kind: "atom", symbol: "C" },
        { index: 1, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 30, kind: "atom", symbol: "S" },
        { index: 31, kind: "atom", symbol: "C" },
        { index: 5, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 6, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 32, kind: "atom", symbol: "C" },
        { index: 33, kind: "atom", symbol: "C" },
        { index: 9, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 34, kind: "atom", symbol: "C" },
        { index: 7, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 8, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" }
      ]
    },
    "2": {
      alias: ["T"],
      brick_type: "BRIDGE",
      id: "2",
      name: "Thiophene",
      edges: [[1, 5], [5, 6], [6, 3], [6, 7], [7, 4], [7, 8], [8, 2], [8, 9], [9, 5]],
      nodes: [
        { index: 1, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 5, kind: "atom", symbol: "C" },
        { index: 6, kind: "atom", symbol: "C" },
        { index: 3, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 7, kind: "atom", symbol: "C" },
        { index: 4, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 8, kind: "atom", symbol: "C" },
        { index: 2, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 9, kind: "atom", symbol: "S" }
      ]
    },
    "3": {
      alias: ["TT"],
      brick_type: "BRIDGE",
      id: "3",
      name: "Thieno[3,2-b]thiophene",
      edges: [[1, 5], [5, 6], [6, 3], [6, 7], [7, 8], [8, 9], [8, 10], [10, 4], [10, 11], [11, 2], [11, 12], [9, 5], [12, 7]],
      nodes: [
        { index: 1, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 5, kind: "atom", symbol: "C" },
        { index: 6, kind: "atom", symbol: "C" },
        { index: 3, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 7, kind: "atom", symbol: "C" },
        { index: 8, kind: "atom", symbol: "C" },
        { index: 9, kind: "atom", symbol: "S" },
        { index: 10, kind: "atom", symbol: "C" },
        { index: 4, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 11, kind: "atom", symbol: "C" },
        { index: 2, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 12, kind: "atom", symbol: "S" }
      ]
    },
    "4": {
      alias: ["C2C4", "EH"],
      brick_type: "SIDE_CHAIN",
      id: "4",
      name: "2-ethylhexyl",
      edges: [[2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [6, 9], [9, 1]],
      nodes: [
        { index: 2, kind: "atom", symbol: "C" },
        { index: 3, kind: "atom", symbol: "C" },
        { index: 4, kind: "atom", symbol: "C" },
        { index: 5, kind: "atom", symbol: "C" },
        { index: 6, kind: "atom", symbol: "C" },
        { index: 7, kind: "atom", symbol: "C" },
        { index: 8, kind: "atom", symbol: "C" },
        { index: 9, kind: "atom", symbol: "C" },
        { index: 1, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" }
      ]
    },
    "5": {
      alias: ["C4C6", "BO"],
      brick_type: "SIDE_CHAIN",
      id: "5",
      name: "2-butyloctyl",
      edges: [[2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 1], [8, 10], [10, 11], [11, 12], [12, 13]],
      nodes: [
        { index: 2, kind: "atom", symbol: "C" },
        { index: 3, kind: "atom", symbol: "C" },
        { index: 4, kind: "atom", symbol: "C" },
        { index: 5, kind: "atom", symbol: "C" },
        { index: 6, kind: "atom", symbol: "C" },
        { index: 7, kind: "atom", symbol: "C" },
        { index: 8, kind: "atom", symbol: "C" },
        { index: 9, kind: "atom", symbol: "C" },
        { index: 1, kind: "port", connected_symbol: "C", preferred_brick_type: "SKELETON" },
        { index: 10, kind: "atom", symbol: "C" },
        { index: 11, kind: "atom", symbol: "C" },
        { index: 12, kind: "atom", symbol: "C" },
        { index: 13, kind: "atom", symbol: "C" }
      ]
    }
  };
})();